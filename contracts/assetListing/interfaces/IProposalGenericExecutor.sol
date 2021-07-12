// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.6.12;

interface IProposalGenericExecutor {
  function execute(
    address[5] calldata tokens, // token, aToken, stableDebtToken, variableDebtToken, interestStrategy
    uint256 ltv,
    uint256 liquidationThreshold,
    uint256 liquidationBonus,
    uint256 reserveFactor,
    uint8 decimals,
    bool[3] calldata assetBehaviour, // enableBorrow, enableStableBorrow, enableAsCollatera
    address assetSource
  ) external;
}