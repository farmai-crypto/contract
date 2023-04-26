import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
require('dotenv').config({path:__dirname+'/.env'});

const config: HardhatUserConfig = {
  gasReporter: {
    enabled: true,
    currency: "USD",
    coinmarketcap: process.env.CMC_API_KEY
  },
  networks:{
    hardhat: {
      allowUnlimitedContractSize: true,
      gas: 20_000_000
    }
  },
  solidity: {
    compilers: [
      { version: "0.8.18", settings: { optimizer: { enabled: true, runs: 1000 }} },
      { version: "0.5.16", settings: { optimizer: { enabled: true, runs: 1000 }} },
      { version: "0.6.6", settings: { optimizer: { enabled: true, runs: 1000 }} },
    ]
  }
};

export default config;
