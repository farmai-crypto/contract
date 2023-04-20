import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  networks:{
    hardhat: {
      allowUnlimitedContractSize: true,
      gas: 20_000_000
    }
  },
  solidity: {
    compilers: [
      { version: "0.8.18" },
      { version: "0.5.16" },
      { version: "0.6.6" },
    ]
  }
};

export default config;
