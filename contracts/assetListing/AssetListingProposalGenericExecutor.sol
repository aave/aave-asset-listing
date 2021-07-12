// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {IERC20} from './interfaces/IERC20.sol';
import {ILendingPoolConfiguratorV2} from './interfaces/ILendingPoolConfiguratorV2.sol';
import {IProposalGenericExecutor} from './interfaces/IProposalGenericExecutor.sol';
import {IOverlyingAsset} from './interfaces/IOverlyingAsset.sol';
import {IAaveOracle} from './interfaces/IAaveOracle.sol';
import {ILendingPoolAddressesProvider} from './interfaces/ILendingPoolAddressesProvider.sol';

/**
 * @title AssetListingProposalGenericExecutor
 * @notice Proposal payload to be executed by the Aave Governance contract via DELEGATECALL
 * @author Aave
 **/
contract AssetListingProposalGenericExecutor is IProposalGenericExecutor {
  event ProposalExecuted();

  ILendingPoolAddressesProvider public constant LENDING_POOL_ADDRESSES_PROVIDER =
    ILendingPoolAddressesProvider(0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5);

  /**
   * @dev Payload execution function, called once a proposal passed in the Aave governance
   */
  function execute(
    address[5] calldata tokens, // token, aToken, stableDebtToken, variableDebtToken, interestStrategy
    uint256 ltv,
    uint256 liquidationThreshold,
    uint256 liquidationBonus,
    uint256 reserveFactor,
    uint8 decimals,
    bool[3] calldata assetBehaviour, // enableBorrow, enableStableBorrow, enableAsCollateral
    address assetSource
  ) external override {
    ILendingPoolConfiguratorV2 LENDING_POOL_CONFIGURATOR_V2 = ILendingPoolConfiguratorV2(
      LENDING_POOL_ADDRESSES_PROVIDER.getLendingPoolConfigurator()
    );

    require(
      tokens[0] == IOverlyingAsset(tokens[1]).UNDERLYING_ASSET_ADDRESS(),
      'ATOKEN: WRONG_UNDERLYING_TOKEN'
    );
    require(
      tokens[0] == IOverlyingAsset(tokens[2]).UNDERLYING_ASSET_ADDRESS(),
      'STABLE_DEBT: WRONG_UNDERLYING_TOKEN'
    );
    require(
      tokens[0] == IOverlyingAsset(tokens[3]).UNDERLYING_ASSET_ADDRESS(),
      'VARIABLE_DEBT: WRONG_UNDERLYING_TOKEN'
    );

    LENDING_POOL_CONFIGURATOR_V2.initReserve(tokens[1], tokens[2], tokens[3], decimals, tokens[4]);

    if (assetBehaviour[0]) {
      LENDING_POOL_CONFIGURATOR_V2.enableBorrowingOnReserve(tokens[0], assetBehaviour[1]);
    }

    LENDING_POOL_CONFIGURATOR_V2.setReserveFactor(tokens[0], reserveFactor);
    if (assetBehaviour[2]) {
      LENDING_POOL_CONFIGURATOR_V2.configureReserveAsCollateral(
        tokens[0],
        ltv,
        liquidationThreshold,
        liquidationBonus
      );
    }

    if (assetSource != address(0)) {
      address priceOracle = LENDING_POOL_ADDRESSES_PROVIDER.getPriceOracle();
      address[] memory assets = new address[](1);
      assets[0] = tokens[0];
      address[] memory sources = new address[](1);
      sources[0] = assetSource;
      IAaveOracle(priceOracle).setAssetSources(assets, sources);
    }

    emit ProposalExecuted();
  }
}
