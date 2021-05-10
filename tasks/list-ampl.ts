import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-ethers';
import { getContractAt } from '@nomiclabs/hardhat-ethers/dist/src/helpers';
import { config } from 'dotenv';
import { IAaveGovernanceV2 } from '../types/IAaveGovernanceV2';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bs58 = require('bs58');
const AAVE_GOVERNANCE_V2 = '0xEC568fffba86c094cf06b22134B23074DFE2252c'; // mainnet
const AAVE_SHORT_EXECUTOR = '0xee56e2b3d491590b5b31738cc34d5232f378a8d5'; // mainnet

config();

task('list:ampl', 'Create some proposals and votes')
  // eslint-disable-next-line no-empty-pattern
  .setAction(async ({}, _DRE: HardhatRuntimeEnvironment) => {
    const {
      IPFS_HASH,
    } = process.env;
    if (
      !IPFS_HASH
    ) {
      throw new Error('please set `IPFS_HASH` as environment variable');
    }
    const proposer = (await _DRE.ethers.getSigners())[0];
    const genericPayloadAddress = (
      await _DRE.deployments.get('AIP12AMPL')
    ).address;
    const executeCallData = new _DRE.ethers.utils.Interface(['function execute()']).encodeFunctionData('execute');
    const gov = (await getContractAt(
      _DRE,
      'IAaveGovernanceV2',
      AAVE_GOVERNANCE_V2 || ''
    )) as IAaveGovernanceV2;
    const ipfsEncoded = `0x${bs58.decode(IPFS_HASH).slice(2).toString('hex')}`;

    await (
      await gov
        .connect(proposer)
        .create(
          AAVE_SHORT_EXECUTOR,
          [genericPayloadAddress],
          ['0'],
          [''],
          [executeCallData],
          [true],
          ipfsEncoded
        )
    ).wait();
    console.log('Your Proposal has been submitted');
  });
