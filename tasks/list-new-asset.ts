import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-ethers';
import { getContractAt } from '@nomiclabs/hardhat-ethers/dist/src/helpers';

const bs58 = require('bs58');
require('dotenv').config();

const {
  TOKEN,
  ATOKEN,
  STABLE_DEBT_TOKEN,
  VARIABLE_DEBT_TOKEN,
  INTEREST_STRATEGY,
  LTV,
  LIQUIDATION_THRESHOLD,
  LIQUIDATION_BONUS,
  RESERVE_FACTOR,
  DECIMALS,
  ENABLE_BORROW,
  ENABLE_AS_COLLATERAL,
  IPFS_HASH,
  AAVE_GOVERNANCE_V2 = '0xEC568fffba86c094cf06b22134B23074DFE2252c', // mainnet
  AAVE_SHORT_EXECUTOR = '0xee56e2b3d491590b5b31738cc34d5232f378a8d5', // mainnet
} = process.env;
if (!TOKEN || !ATOKEN || !STABLE_DEBT_TOKEN || !VARIABLE_DEBT_TOKEN
  || !INTEREST_STRATEGY || !LTV || !LIQUIDATION_BONUS || !LIQUIDATION_THRESHOLD || !DECIMALS
  || (ENABLE_BORROW !== 'true' && ENABLE_BORROW !== 'false')
  || (ENABLE_AS_COLLATERAL !== 'true' && ENABLE_AS_COLLATERAL !== 'false')
  || !IPFS_HASH || !AAVE_GOVERNANCE_V2 || !AAVE_SHORT_EXECUTOR
) {
  throw new Error('You have not set correctly the .env file, make sure to read the README.md');
}

task('create:proposal-new-asset', 'Create some proposals and votes')
  // eslint-disable-next-line no-empty-pattern
  .setAction(async ({ }, _DRE) => {
    const proposer = (await _DRE.ethers.getSigners())[0];
    const genericPayloadAddress = (await _DRE.deployments.get('AssetListingProposalGenericExecutor')).address;
    const executeSignature = 'execute(address,address,address,address,address,uint256,uint256,uint256,uint8,bool,bool';
    const callData = _DRE.ethers.utils.defaultAbiCoder.encode([
      'address',
      'address',
      'address',
      'address',
      'address',
      'uint',
      'uint',
      'uint',
      'uint',
      'uint8',
      'bool',
      'bool',
    ],
    [
      TOKEN,
      ATOKEN,
      STABLE_DEBT_TOKEN,
      VARIABLE_DEBT_TOKEN,
      INTEREST_STRATEGY,
      LTV,
      LIQUIDATION_THRESHOLD,
      LIQUIDATION_BONUS,
      RESERVE_FACTOR,
      DECIMALS,
      ENABLE_BORROW === 'true',
      ENABLE_AS_COLLATERAL === 'true',
    ]);
    const gov = await getContractAt(_DRE, 'IAaveGovernanceV2', AAVE_GOVERNANCE_V2 || '');
    const ipfsEncoded = `0x${bs58
      .decode(IPFS_HASH)
      .slice(2)
      .toString('hex')}`;

    await (
      await gov
        .connect(proposer)
        .create(AAVE_SHORT_EXECUTOR, [genericPayloadAddress], ['0'], [executeSignature], [callData], [true], ipfsEncoded)
    ).wait();
    console.log('Your Proposal has been submitted');
  });
