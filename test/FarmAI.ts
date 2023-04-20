import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";

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
    const router = await FarmAIUniswapRouter.deploy(factoryContract.address, weth.address);
    const farmAIContract = await FarmAI.deploy(router.address);
    // Provide liquidity.
    await farmAIContract.approve(router.address, ethers.constants.MaxUint256);
    await router.addLiquidityETH(
      farmAIContract.address,
      (await farmAIContract.functions.TOTAL_SUPPLY())[0].mul(15).div(100), 
      0, 0,
      owner.address,
      (await time.latest()) + 1_000,
      { value: ethers.utils.parseEther("100") }
    );
    const farmAIAddress = farmAIContract.address;
    const routerAddress = router.address;
    return { farmAIAddress, routerAddress, owner, alice, bob };
  }

  describe("Deployment", function () {
    it("Owner is correct", async function () {
      const { farmAIAddress, routerAddress, owner, alice, bob } = await loadFixture(deployFarmAIFixture);
      const farmAI = await (await (await ethers.getContractFactory("FarmAI")).attach(farmAIAddress)).connect(alice);
      expect(await farmAI.owner()).to.eq(owner.address);
    });
  });
});
