// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.6.12;

interface IAAMPL {
  function setDebtTokens(address stableDebt, address variableDebt) external;
}
