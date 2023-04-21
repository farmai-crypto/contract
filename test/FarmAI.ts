import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";

const parseEther = ethers.utils.parseEther;
const inFutureTime = async() => (await time.latest()) + 3_000;

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
    });
    describe("Sell", async() => {
      it("Buy 5min after start, sell within 24h: 35% fee", async() =>{
        const { farmAIOwner, routerOwner, weth, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
        const farmAIBob = await farmAIOwner.connect(bob);
        const routerBob = await routerOwner.connect(bob);
        const tokenBalance = await farmAIOwner.balanceOf(bob.address);
        const ethToSpend = parseEther("10");
        await farmAIOwner.startTrading();
        await farmAIOwner.setLiquidationSettings(1_000, 10_000, false);
        await time.increase(3 * 60);
        await routerBob.swapExactETHForTokensSupportingFeeOnTransferTokens(
          0, [weth.address, farmAIOwner.address],
          bob.address, await inFutureTime(),
          {value: ethToSpend}
        );
        await farmAIBob.approve(routerBob.address, ethers.constants.MaxUint256);
        const tokensGained = (await farmAIOwner.balanceOf(bob.address)).sub(tokenBalance);
        const expectedEthToGainWithoutFee = (await routerBob.getAmountsOut(tokensGained, [farmAIOwner.address, weth.address]))[1];
        const expectedEthToGainWithFee = (await routerBob.getAmountsOut(tokensGained.mul(65).div(100), [farmAIOwner.address, weth.address]))[1];
        const ethBalance = await routerBob.provider.getBalance(bob.address);
        // Fast-forward another 18h and sell.
        await time.increase(18 * 60 * 60);
        const txn = await (await routerBob.swapExactTokensForETHSupportingFeeOnTransferTokens(
          tokensGained, 0, 
          [farmAIOwner.address, weth.address],
          bob.address, await inFutureTime()
        )).wait();
        const txnCost = txn.gasUsed.mul(txn.effectiveGasPrice);
        const ethGained = (await routerBob.provider.getBalance(bob.address)).sub(ethBalance);
        expect(ethGained).to.eq(expectedEthToGainWithFee.sub(txnCost));
      });
      it("Buy 15min after start, sell within 24h: 25%fee", async() =>{
        const { farmAIOwner, routerOwner, weth, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
        await farmAIOwner.startTrading();
      });
      it("Buy 30min after start, sell within 24h: 20%fee", async() =>{
        const { farmAIOwner, routerOwner, weth, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
        await farmAIOwner.startTrading();
      });
    });
    
  });
});