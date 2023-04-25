import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { NumberLike } from "@nomicfoundation/hardhat-network-helpers/dist/src/types";
import { FarmAI } from "../typechain-types";

const parseEther = ethers.utils.parseEther;
const inFutureTime = async() => (await time.latest()) + 3_000;

// Utility constants.
const HOUR = 3600;
const MINUTE = 60;

describe("FarmAI", function () {
  // We define a fixture to reuse the same setup in every test.
  // We use loadFixture to run this setup once, snapshot that state,
  // and reset Hardhat Network to that snapshot in every test.
  async function deployFarmAIFixture() {
    // Contracts are deployed using the first signer/account by default
    const [owner, alice, bob] = await ethers.getSigners();

    const FarmAIWeth = await ethers.getContractFactory("WETH");
    const FarmAIUniswapFactory = await ethers.getContractFactory("FarmAIUniswapFactory");
    const FarmAIUniswapRouter = await ethers.getContractFactory("FarmAIUniswapRouter");
    const FarmAI = await ethers.getContractFactory("FarmAI");
    // Deploy contracts.
    const weth = (await FarmAIWeth.deploy());
    const factoryContract = await FarmAIUniswapFactory.deploy();
    const routerOwner = await FarmAIUniswapRouter.deploy(factoryContract.address, weth.address);
    const farmAIOwner = await FarmAI.deploy(routerOwner.address);
    // Provide liquidity.
    await farmAIOwner.approve(routerOwner.address, ethers.constants.MaxUint256);
    await routerOwner.addLiquidityETH(
      farmAIOwner.address,
      (await farmAIOwner.functions.TOTAL_SUPPLY())[0].mul(10).div(100), 
      0, 0,
      owner.address,
      (await time.latest()) + 1_000,
      { value: parseEther("100") }
    );
    return { farmAIOwner, routerOwner, weth, owner, alice, bob };
  }

  describe("Deployment", function () {
    it("Initial settings are correct", async function () {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAI = await farmAIOwner.connect(alice);
      
      expect(await farmAI.TOTAL_SUPPLY()).to.eq(parseEther("1000000"));
      // Initial liquidity provided during tests.
      expect(await farmAI.balanceOf(owner.address)).to.eq(
        (await farmAI.functions.TOTAL_SUPPLY())[0].mul(90).div(100)
      );
      expect(await farmAI.owner()).to.eq(owner.address);
      expect(await farmAI.fees()).to.eql([500, 500, 1000, 500, 500, 1000, ethers.BigNumber.from(0)]);
      expect(await farmAI.ignoreFees(owner.address)).to.eq(true);
      expect(await farmAI.teamWallet()).to.eq(owner.address);
      expect(await farmAI.liquidityWallet()).to.eq(owner.address);
    });
  });
  describe("Utility functions", function() {
    it("recoverERC20", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const tokensToReclaim = parseEther("100");
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.recoverERC20(farmAIAlice.address, tokensToReclaim)).to.be.revertedWith("Ownable: caller is not the owner");
      // Send alice some tokens to check if we can get them back.
      await farmAIOwner.transfer(alice.address, parseEther("1000"));
      await farmAIOwner.whiteListTrade(alice.address, true);
      await farmAIAlice.transfer(farmAIAlice.address, tokensToReclaim);
      // Reclaim on owner.
      const ownerTokenBalanceBefore = await farmAIOwner.balanceOf(owner.address);
      const contractTokenBalance = await farmAIOwner.balanceOf(farmAIOwner.address);
      await farmAIOwner.recoverERC20(farmAIOwner.address, contractTokenBalance);
      const ownerTokenBalanceGained = (await farmAIOwner.balanceOf(owner.address)).sub(ownerTokenBalanceBefore);

      expect(ownerTokenBalanceGained).to.eq(tokensToReclaim);
    });
    it("recoverETH", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const ethToClaim = parseEther("24");
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.recoverETH(ethToClaim)).to.be.revertedWith("Ownable: caller is not the owner");
      // Send some ether from bob to contract.
      await bob.sendTransaction({ to: farmAIOwner.address, value: ethToClaim });
      // Reclaim on owner.
      const ownerEthBefore = await farmAIOwner.provider.getBalance(owner.address);
      const contractEthBalance = await farmAIOwner.provider.getBalance(farmAIOwner.address);
      const recoverTxn = await (await farmAIOwner.recoverETH(contractEthBalance)).wait();
      const recoverTxnCost = recoverTxn.gasUsed.mul(recoverTxn.effectiveGasPrice);
      const ownerEthGained = (await farmAIOwner.provider.getBalance(owner.address))
        .sub(ownerEthBefore);

      expect(ownerEthGained).to.eq(ethToClaim.sub(recoverTxnCost));
    });
    it("setFees", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.setFees(200, 200, 300, 300)).to.be.revertedWith("Ownable: caller is not the owner");
      // Maximum of buy and sell is 30% each.
      await expect(farmAIOwner.setFees(1337, 2000, 400, 800)).to.be.revertedWith("FAI: TAXES_TOO_HIGH");
      await expect(farmAIOwner.setFees(1337, 2000, 600, 2401)).to.be.revertedWith("FAI: TAXES_TOO_HIGH");
      await expect(farmAIOwner.setFees(1337, 1664, 200, 4500)).to.be.revertedWith("FAI: TAXES_TOO_HIGH");
      await farmAIOwner.setFees(350, 150, 1100, 400);
    });
    it("setTakeFeeFor", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.setTakeFeeFor(alice.address, false)).to.be.revertedWith("Ownable: caller is not the owner");
      // Set and unset fees to take.
      expect(await farmAIOwner.takeFeesFor(alice.address)).to.be.eq(false);
      await farmAIOwner.setTakeFeeFor(bob.address, true);
      expect(await farmAIOwner.takeFeesFor(alice.address)).to.be.eq(false);
      await farmAIOwner.setTakeFeeFor(alice.address, true);
      expect(await farmAIOwner.takeFeesFor(alice.address)).to.be.eq(true);
      await farmAIOwner.setTakeFeeFor(alice.address, false);
      expect(await farmAIOwner.takeFeesFor(alice.address)).to.be.eq(false);
    });
    it("setIgnoreFees", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.setIgnoreFees(alice.address, true)).to.be.revertedWith("Ownable: caller is not the owner");
      // Set and unset ignore fees.
      expect(await farmAIOwner.ignoreFees(owner.address)).to.be.eq(true);
      await farmAIOwner.setIgnoreFees(bob.address, false);
      expect(await farmAIOwner.ignoreFees(owner.address)).to.be.eq(true);
      await farmAIOwner.setIgnoreFees(owner.address, false);
      expect(await farmAIOwner.ignoreFees(owner.address)).to.be.eq(false);
      await farmAIOwner.setIgnoreFees(owner.address, true);
      expect(await farmAIOwner.ignoreFees(owner.address)).to.be.eq(true);
    });
    it("setTeamWallet", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.setTeamWallet(alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
      expect(await farmAIOwner.teamWallet()).to.eq(owner.address);
      await farmAIOwner.setTeamWallet(bob.address);
      expect(await farmAIOwner.teamWallet()).to.eq(bob.address);
    });
    it("setLiquidityWallet", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.setLiquidityWallet(alice.address)).to.be.revertedWith("Ownable: caller is not the owner");
      expect(await farmAIOwner.liquidityWallet()).to.eq(owner.address);
      await farmAIOwner.setLiquidityWallet(bob.address);
      expect(await farmAIOwner.liquidityWallet()).to.eq(bob.address);
    });
    it("setLiquiditationSettings", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.setLiquidationSettings(parseEther("100"), 10000, true)).to.be.revertedWith("Ownable: caller is not the owner");
      // Settings must follow contract token supply and max percentage (100% => 10000)
      await expect(farmAIOwner.setLiquidationSettings(
        (await farmAIOwner.TOTAL_SUPPLY()).add(1),
        10_000,
        true
      )).to.be.revertedWith("FAI: INVALID_LIQ_SETT");
      await expect(farmAIOwner.setLiquidationSettings(
        (await farmAIOwner.TOTAL_SUPPLY()),
        10_001,
        true
      )).to.be.revertedWith("FAI: INVALID_LIQ_SETT");
      await farmAIOwner.setLiquidationSettings(
        (await farmAIOwner.TOTAL_SUPPLY()),
        10_000,
        true
      )
    });
    it("startTrading", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.startTrading()).to.be.revertedWith("Ownable: caller is not the owner");
      expect(await farmAIOwner.tradingEnabled()).to.eq(false);
      await farmAIOwner.startTrading();
      expect(await farmAIOwner.tradingEnabled()).to.eq(true);
    });
    it("whiteListTrade", async() => {
      const { farmAIOwner, routerOwner, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAIAlice = await farmAIOwner.connect(alice);
      // Disallowed by anyone but owner.
      await expect(farmAIAlice.whiteListTrade(alice.address, true)).to.be.revertedWith("Ownable: caller is not the owner");
      expect(await farmAIOwner.tradingWhiteList(alice.address)).to.eq(false);
      await farmAIOwner.whiteListTrade(alice.address, true);
      expect(await farmAIOwner.tradingWhiteList(alice.address)).to.eq(true);
      await farmAIOwner.whiteListTrade(alice.address, false);
      expect(await farmAIOwner.tradingWhiteList(alice.address)).to.eq(false);
    });
  });
  describe("Trading", async() => {
    it("Trading disabled before actively launched", async() => {
      const { farmAIOwner, routerOwner, weth, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const routerAlice = await routerOwner.connect(alice);
      
      await expect(routerAlice.swapExactETHForTokensSupportingFeeOnTransferTokens(
        0, [weth.address, farmAIOwner.address], alice.address,
        await inFutureTime(), { value: parseEther("5") }
      )).to.be.revertedWith("UniswapV2: TRANSFER_FAILED");
      await farmAIOwner.startTrading();
      await routerAlice.swapExactETHForTokensSupportingFeeOnTransferTokens(
        0, [weth.address, farmAIOwner.address], alice.address,
        await inFutureTime(), { value: parseEther("5") }
      );
    });
    describe("Buy", async() => {
      it("5% common fee", async() => {
        const { farmAIOwner, routerOwner, weth, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
        const routerBob = await routerOwner.connect(bob);
        const ethToSpend = parseEther("10");
        const tokensToGetWithoutFee = (await routerBob.getAmountsOut(ethToSpend, [weth.address, farmAIOwner.address]))[1];
        const tokensToGetWithFee = tokensToGetWithoutFee.mul(90).div(100).add(1);
        const tokenBalance = await farmAIOwner.balanceOf(bob.address);
        await farmAIOwner.startTrading();
        await routerBob.swapExactETHForTokensSupportingFeeOnTransferTokens(
          0, [weth.address, farmAIOwner.address],
          bob.address, await inFutureTime(),
          {value: ethToSpend}
        );
        const tokensGained = (await farmAIOwner.balanceOf(bob.address)).sub(tokenBalance);
        expect(tokensGained).to.eq(tokensToGetWithFee);
      });
      it("No fees for ignored addresses", async() => {
        const { farmAIOwner, routerOwner, weth, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
        const routerBob = await routerOwner.connect(bob);
        const etherToSpend = parseEther("100");
        await farmAIOwner.setIgnoreFees(bob.address, true);
        await farmAIOwner.startTrading();
        const expectedTokensToGain = (await routerBob.getAmountsOut(etherToSpend, [weth.address, farmAIOwner.address]))[1];
        const tokensGained = await buy(bob, farmAIOwner.address, routerBob.address, weth.address, etherToSpend);
        expect(tokensGained).to.eq(expectedTokensToGain);
      });
    });
    describe("Sell", async() => {
      type Sell = {
        after: number,
        fee: number
      };
      async function buyAndSellOnce(buyAfter: number, sellAfter: number, fee: number, fixture: any){
        return await buysAndSellAfter([buyAfter], [{after: sellAfter, fee: fee}], fixture);
      }
      async function buysAndSellAfter(buyAfterDeltas: number[], sellsAfter: Sell[], fixture = undefined){
        const { farmAIOwner, routerOwner, weth, owner, alice, bob } = fixture == undefined ? await loadFixture(deployFarmAIFixture) : fixture;
        const farmAIBob = await farmAIOwner.connect(bob);
        const routerBob = await routerOwner.connect(bob);
        const ethToSpend = parseEther("10");
        const initialContractTokenBalance = await farmAIOwner.balanceOf(farmAIOwner.address);
        let tokensGained = ethers.BigNumber.from(0);
        let tokensTakenAsFees = ethers.BigNumber.from(0);
        await farmAIOwner.setLiquidationSettings(1_000, 10_000, false);
        await farmAIOwner.startTrading();
        for(const buyAfter of buyAfterDeltas){
          await time.increase(buyAfter - 1);
          const tokenBalance = await farmAIOwner.balanceOf(bob.address);
          const buyFeesTaken = ((await routerBob.getAmountsOut(ethToSpend, [weth.address, farmAIOwner.address]))[1]).mul(10).div(100);
          tokensTakenAsFees = tokensTakenAsFees.add(buyFeesTaken);
          await routerBob.swapExactETHForTokensSupportingFeeOnTransferTokens(
            0, [weth.address, farmAIOwner.address],
            bob.address, await inFutureTime(),
            {value: ethToSpend}
          );
          const tokensGainedForPurchase = (await farmAIOwner.balanceOf(bob.address)).sub(tokenBalance);
          tokensGained = tokensGained.add(tokensGainedForPurchase);
        }
        await farmAIBob.approve(routerBob.address, ethers.constants.MaxUint256);
        const ethBalance = await routerBob.provider.getBalance(bob.address);
        // Fast-forward and sell.
        const tokensToSell = tokensGained.div(sellsAfter.length);
        let expectedEthToGainWithFee = ethers.BigNumber.from(0);
        for(const sell of sellsAfter){
          await time.increase(sell.after);
          expectedEthToGainWithFee = expectedEthToGainWithFee.add(
            (await routerBob.getAmountsOut(tokensToSell.mul(100 - sell.fee).div(100), [farmAIOwner.address, weth.address]))[1]
          );
          tokensTakenAsFees = tokensTakenAsFees.add(tokensToSell.mul(sell.fee).div(100));
          const txn = await (await routerBob.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokensToSell, 0, 
            [farmAIOwner.address, weth.address],
            bob.address, await inFutureTime()
          )).wait();
          const txnCost = txn.gasUsed.mul(txn.effectiveGasPrice);
          expectedEthToGainWithFee = expectedEthToGainWithFee.sub(txnCost);
        }
        const ethGained = (await routerBob.provider.getBalance(bob.address)).sub(ethBalance);
        const contractTokensGained = (await farmAIOwner.balanceOf(farmAIOwner.address)).sub(initialContractTokenBalance);

        expect(ethGained).to.eq(expectedEthToGainWithFee);
        // Acceptance interval due to imprecise calculations.
        expect(contractTokensGained.sub(tokensTakenAsFees).abs()).to.be.lessThanOrEqual(10);
      }
      it("No fees for ignored addresses", async() => {
        const { farmAIOwner, routerOwner, weth, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
        const routerBob = await routerOwner.connect(bob);
        await farmAIOwner.setIgnoreFees(bob.address, true);
        await farmAIOwner.startTrading();
        const tokensGained = await buy(bob, farmAIOwner.address, routerBob.address, weth.address, parseEther("100"));
        const expectedEthToGain = (await routerBob.getAmountsOut(tokensGained, [farmAIOwner.address, weth.address]))[1];
        const ethGained = await sell(bob, farmAIOwner.address, routerBob.address, weth.address, tokensGained);
        expect(ethGained).to.eq(expectedEthToGain);
      });
      describe("Within 24h", async() => {
        it("Buy after 3m => 35% fee", async() =>{ await buysAndSellAfter([3 * MINUTE], [{after: 4 * HOUR, fee: 35}]); });
        it("Buy after 5m => 35% fee", async() =>{ await buysAndSellAfter([5 * MINUTE], [{after: 4 * HOUR, fee: 35}]); });
        it("Buy after 5m1s => 25% fee", async() =>{ await buysAndSellAfter([5 * MINUTE + 1], [{after: 4 * HOUR, fee: 25}]); });
        it("Buy after 15m => 25%fee", async() =>{ await buysAndSellAfter([15 * MINUTE], [{after: 4 * HOUR, fee: 25}]); });
        it("Buy after 15m1s => 20%fee", async() =>{ await buysAndSellAfter([15 * MINUTE + 1], [{after: 4 * HOUR, fee: 20}]); });
        it("Buy after 30m => 20%fee", async() =>{ await buysAndSellAfter([30 * MINUTE], [{after: 4 * HOUR, fee: 20}]); });
        it("Buy after 30m1s => 10%fee", async() =>{ await buysAndSellAfter([30 * MINUTE + 1], [{after: 4 * HOUR, fee: 10}]); });
        it("Buy twice, 3m30s & 10m30s => 35% fee", async() => { await buysAndSellAfter([3 * MINUTE + 30, 7 * MINUTE], [{after: 4 * HOUR, fee: 35}]); });
        it("Buy twice, 14m20s & 24m => 25% fee", async() => { await buysAndSellAfter([14 * MINUTE + 20, 9 * MINUTE + 40], [{after: 4 * HOUR, fee: 25}]); });
        it("Buy twice, 14s & 22m => 35% fee", async() => { await buysAndSellAfter([14, 21 * MINUTE + 46], [{after: 4 * HOUR, fee: 35}]); });
        it("Buy thrice, 40s & 7m & 29m => 35% fee", async() => { await buysAndSellAfter([40, 6 * MINUTE + 20, 22 * MINUTE], [{after: 4 * HOUR, fee: 35}]); });
      });
      describe("After 24h", async() => {
        it("Buy after 3m => 10% fee", async() =>{ await buysAndSellAfter([3 * MINUTE], [{after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy after 5m => 10% fee", async() =>{ await buysAndSellAfter([5 * MINUTE], [{after: 24 * HOUR + 2, fee: 10}]); });
        it("Buy after 5m1s => 10% fee", async() =>{ await buysAndSellAfter([5 * MINUTE + 1], [{after: 24 * HOUR + 3, fee: 10}]); });
        it("Buy after 15m => 10%fee", async() =>{ await buysAndSellAfter([15 * MINUTE], [{after: 24 * HOUR + 5, fee: 10}]); });
        it("Buy after 15m1s => 10%fee", async() =>{ await buysAndSellAfter([15 * MINUTE + 1], [{after: 25 * HOUR, fee: 10}]); });
        it("Buy after 30m => 10%fee", async() =>{ await buysAndSellAfter([30 * MINUTE], [{after: 30 * HOUR, fee: 10}]); });
        it("Buy after 30m1s => 10%fee", async() =>{ await buysAndSellAfter([30 * MINUTE + 1], [{after: 36 * HOUR, fee: 10}]); });
        it("Buy twice, 3m30s & 10m30s => 10% fee", async() => { await buysAndSellAfter([3 * MINUTE + 30, 7 * MINUTE], [{after: 37 * HOUR, fee: 10}]); });
        it("Buy twice, 14m20s & 24m => 10% fee", async() => { await buysAndSellAfter([14 * MINUTE + 20, 9 * MINUTE + 40], [{after: 44 * HOUR, fee: 10}]); });
        it("Buy twice, 14s & 22m => 10% fee", async() => { await buysAndSellAfter([14, 21 * MINUTE + 46], [{after: 56 * HOUR, fee: 10}]); });
        it("Buy thrice, 40s & 7m & 29m => 10% fee", async() => { await buysAndSellAfter([40, 6 * MINUTE + 20, 22 * MINUTE], [{after: 69 * HOUR, fee: 10}]); });
      });
      describe("Once within 24h, once afterwards", async() => {
        it("Buy after 3m => 35% & 10% fee", async() =>{ await buysAndSellAfter([3 * MINUTE], [{after: 2 * HOUR, fee: 35}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy after 5m => 35% & 10% fee", async() =>{ await buysAndSellAfter([5 * MINUTE], [{after: 2 * HOUR, fee: 35}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy after 5m1s => 25% & 10% fee", async() =>{ await buysAndSellAfter([5 * MINUTE + 1], [{after: 2 * HOUR, fee: 25}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy after 15m => 25% & 10% fee", async() =>{ await buysAndSellAfter([15 * MINUTE], [{after: 2 * HOUR, fee: 25}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy after 15m1s => 20% & 10% fee", async() =>{ await buysAndSellAfter([15 * MINUTE + 1], [{after: 2 * HOUR, fee: 20}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy after 30m => 20% & 10% fee", async() =>{ await buysAndSellAfter([30 * MINUTE], [{after: 2 * HOUR, fee: 20}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy after 30m1s => 10% & 10% fee", async() =>{ await buysAndSellAfter([30 * MINUTE + 1], [{after: 2 * HOUR, fee: 10}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy twice, 3m30s & 10m30s => 35% & 10% fee", async() => { await buysAndSellAfter([3 * MINUTE + 30, 7 * MINUTE], [{after: 2 * HOUR, fee: 35}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy twice, 14m20s & 24m => 25% & 10% fee", async() => { await buysAndSellAfter([14 * MINUTE + 20, 9 * MINUTE + 40], [{after: 2 * HOUR, fee: 25}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy twice, 14s & 22m => 35% & 10% fee", async() => { await buysAndSellAfter([14, 21 * MINUTE + 46], [{after: 2 * HOUR, fee: 35}, {after: 24 * HOUR + 1, fee: 10}]); });
        it("Buy thrice, 40s & 7m & 29m => 35% & 10% fee", async() => { await buysAndSellAfter([40, 6 * MINUTE + 20, 22 * MINUTE], [{after: 2 * HOUR, fee: 35}, {after: 24 * HOUR + 1, fee: 10}]); });
      });
    });
    describe("Complex scenarios", async() => {
      it("#1: 2 accs buy (10eth/20eth) early and sell all within 24h", async() => {
        const { farmAIOwner, routerOwner, weth, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
        const aliceEthToSpend = parseEther("10");
        await farmAIOwner.startTrading();
        const ownerBalanceBefore = await farmAIOwner.provider.getBalance(owner.address);
        const aliceTokensEarned = await buy(alice, farmAIOwner.address, routerOwner.address, weth.address, aliceEthToSpend);
        const bobEthToSpend = parseEther("20");
        await buy(bob, farmAIOwner.address, routerOwner.address, weth.address, bobEthToSpend);
        // Should not trigger liquidation yet.
        expect(await farmAIOwner.provider.getBalance(owner.address)).to.eq(ownerBalanceBefore);
        await sell(alice, farmAIOwner.address, routerOwner.address, weth.address, aliceTokensEarned);
        const ownerEthGained = (await farmAIOwner.provider.getBalance(owner.address)).sub(ownerBalanceBefore);
        // With a trading volume of 40 eth they should have at least gotten 1 eth or more.
        expect(ownerEthGained).to.be.greaterThan(parseEther("1"));
        expect(await farmAIOwner.balanceOf(farmAIOwner.address)).to.be.lessThanOrEqual(1);
      });
    });
    async function buy(from: SignerWithAdress, farmAIAddress: string, routerAddress: string, wethAddress: string, amount: ethers.BigNumber){
      const userContract = await (await (await ethers.getContractFactory("FarmAI")).connect(from)).attach(farmAIAddress);
      const userRouter = await (await (await ethers.getContractFactory("FarmAIUniswapRouter")).connect(from)).attach(routerAddress);
      const weth = await (await (await ethers.getContractFactory("WETH")).connect(from)).attach(wethAddress);
      const tokenBalance = await userContract.balanceOf(from.address);
      await userRouter.swapExactETHForTokensSupportingFeeOnTransferTokens(
        0, [weth.address, userContract.address],
        from.address, await inFutureTime(),
        {value: amount}
      );
      const tokensGained = (await userContract.balanceOf(from.address)).sub(tokenBalance);
      return tokensGained;
    }
    async function sell(from: SignerWithAdress, farmAIAddress: string, routerAddress: string, wethAddress: string, amount: ethers.BigNumber){
      const userContract = await (await (await ethers.getContractFactory("FarmAI")).connect(from)).attach(farmAIAddress);
      const userRouter = await (await (await ethers.getContractFactory("FarmAIUniswapRouter")).connect(from)).attach(routerAddress);
      const weth = await (await (await ethers.getContractFactory("WETH")).connect(from)).attach(wethAddress);
      await userContract.approve(userRouter.address, ethers.constants.MaxUint256);
      const ethBalance = await userContract.provider.getBalance(from.address);
      const txn = await(await userRouter.swapExactTokensForETHSupportingFeeOnTransferTokens(
        amount, 0, 
        [userContract.address, weth.address],
        from.address, await inFutureTime()
      )).wait();
      const txnCost = txn.gasUsed.mul(txn.effectiveGasPrice);
      const ethGained = (await userContract.provider.getBalance(from.address)).sub(ethBalance);
      return ethGained.add(txnCost);
    }
  });
});