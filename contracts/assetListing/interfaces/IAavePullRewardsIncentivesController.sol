// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.5;
pragma experimental ABIEncoderV2;

import {IAaveIncentivesController} from '../interfaces/IAaveIncentivesController.sol';

interface IAavePullRewardsIncentivesController is IAaveIncentivesController {
  event RewardsVaultUpdated(address indexed vault);

  /**
   * @dev update the rewards vault address, only allowed by the Rewards admin
   * @param rewardsVault The address of the rewards vault
   **/
  function setRewardsVault(address rewardsVault) external;
}
