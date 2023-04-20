// SPDX-License-Identifier: MIT
pragma solidity =0.5.16;

import "@uniswap/v2-core/contracts/UniswapV2Factory.sol";

contract FarmAIUniswapFactory is UniswapV2Factory {
  bool notAbstract = true;
  
  constructor() UniswapV2Factory(msg.sender) public {

  }

  function doesNotMakeAbstract() external {
    notAbstract = !notAbstract;
  }
}