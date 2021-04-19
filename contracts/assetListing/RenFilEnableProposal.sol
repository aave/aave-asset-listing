// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.6.12;

import {ILendingPoolConfiguratorV2} from './interfaces/ILendingPoolConfiguratorV2.sol';
import {ILendingPoolAddressesProvider} from './interfaces/ILendingPoolAddressesProvider.sol';
/**
 * @title RenFilEnableProposal
 * @notice Proposal payload to be executed by the Aave Governance contract via DELEGATECALL
 * @author Aave
 **/
contract RenFilEnableProposal {
  
  event ProposalExecuted();

  address public constant RENFIL = 0xD5147bc8e386d91Cc5DBE72099DAC6C9b99276F5;
  ILendingPoolAddressesProvider public constant LENDING_POOL_ADDRESSES_PROVIDER = 
    ILendingPoolAddressesProvider(0xB53C1a33016B2DC2fF3653530bfF1848a515c8c5);
  /**
   * @dev Payload execution function, called once a proposal passed in the Aave governance
   */
  function execute() external {
    ILendingPoolConfiguratorV2 LENDING_POOL_CONFIGURATOR_V2 =
      ILendingPoolConfiguratorV2(LENDING_POOL_ADDRESSES_PROVIDER.getLendingPoolConfigurator());
    
    LENDING_POOL_CONFIGURATOR_V2.enableBorrowingOnReserve(RENFIL, false);

    emit ProposalExecuted();
  }
}
