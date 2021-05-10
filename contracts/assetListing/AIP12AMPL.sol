// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.6.12;
pragma experimental ABIEncoderV2;

import {IERC20} from './interfaces/IERC20.sol';
import {ILendingPoolConfiguratorV2} from './interfaces/ILendingPoolConfiguratorV2.sol';
import {IOverlyingAsset} from './interfaces/IOverlyingAsset.sol';
import {ILendingPoolAddressesProvider} from './interfaces/ILendingPoolAddressesProvider.sol';
import {IAAMPL} from './interfaces/IAAMPL.sol';
import {ILendingPool, DataTypes} from './interfaces/ILendingPool.sol';
/**
 * @title AssetListingProposalGenericExecutor
 * @notice Proposal payload to be executed by the Aave Governance contract via DELEGATECALL
 * @author Aave
 **/
contract AIP12AMPL {
  event ProposalExecuted();

  ILendingPoolAddressesProvider public constant LENDING_POOL_ADDRESSES_PROVIDER = 
    ILendingPoolAddressesProvider(0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5);

  address public constant token = 0xD46bA6D942050d489DBd938a2C909A5d5039A161;
  address public constant aToken = 0x6fBC3BE5ee5273598d1491D41bB45F6d05a7541A;
  address public constant stableDebtToken = 0x0e8f4fc4c261d454b13C74507Bce8C38AA990361;
  address public constant variableDebtToken = 0x3A38bbc6438d2CE2a9e8F116F315a23433755947;
  address public constant interestStrategy = 0x9A8CA7e1d64AFfF2664443B3803f280345F5336B;
  uint256 public constant ltv = 0;
  uint256 public constant liquidationThreshold = 0;
  uint256 public constant liquidationBonus = 0;
  uint256 public constant reserveFactor = 2000;
  uint8 public constant decimals = 9;

  /**
   * @dev Payload execution function, called once a proposal passed in the Aave governance
   */
  function execute() external {
    ILendingPoolConfiguratorV2 LENDING_POOL_CONFIGURATOR_V2 =
      ILendingPoolConfiguratorV2(LENDING_POOL_ADDRESSES_PROVIDER.getLendingPoolConfigurator());
    require(
      token == IOverlyingAsset(aToken).UNDERLYING_ASSET_ADDRESS(),
      'ATOKEN: WRONG_UNDERLYING_TOKEN'
    );
    require(
      token == IOverlyingAsset(stableDebtToken).UNDERLYING_ASSET_ADDRESS(),
      'STABLE_DEBT: WRONG_UNDERLYING_TOKEN'
    );
    require(
      token == IOverlyingAsset(variableDebtToken).UNDERLYING_ASSET_ADDRESS(),
      'VARIABLE_DEBT: WRONG_UNDERLYING_TOKEN'
    );
    LENDING_POOL_CONFIGURATOR_V2.initReserve(
      aToken,
      stableDebtToken,
      variableDebtToken,
      decimals,
      interestStrategy
    );
    LENDING_POOL_CONFIGURATOR_V2.enableBorrowingOnReserve(token, false);
    LENDING_POOL_CONFIGURATOR_V2.setReserveFactor(token, reserveFactor);

    ILendingPool pool = ILendingPool(LENDING_POOL_ADDRESSES_PROVIDER.getLendingPool());

    DataTypes.ReserveData memory reserve = pool.getReserveData(token);

    IAAMPL(reserve.aTokenAddress).initializeDebtTokens();

    emit ProposalExecuted();
  }
}
