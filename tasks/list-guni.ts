import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-ethers';
import { getContractAt } from '@nomiclabs/hardhat-ethers/dist/src/helpers';
import { config } from 'dotenv';
import { IAaveGovernanceV2 } from '../types/IAaveGovernanceV2';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bs58 = require('bs58');

config();

task('create:proposal-new-asset:guni', 'Get the calldata to make a proposal to list G-UNIs')
  // eslint-disable-next-line no-empty-pattern
  .setAction(async ({}, _DRE: any) => {
    const {
      IPFS_HASH,
      AAVE_GOVERNANCE_V2 = '0xEC568fffba86c094cf06b22134B23074DFE2252c', // mainnet
      AAVE_SHORT_EXECUTOR = '0xee56e2b3d491590b5b31738cc34d5232f378a8d5', // mainnet
      AAVE_PRICE_ORACLE_V2 = '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9' // mainnet
    } = process.env;
    if (
      !IPFS_HASH ||
      !AAVE_GOVERNANCE_V2 ||
      !AAVE_SHORT_EXECUTOR ||
      ! AAVE_PRICE_ORACLE_V2
    ) {
      throw new Error('You have not set correctly the .env file, make sure to read the README.md');
    }
    const proposer = (await _DRE.ethers.getSigners())[0];
    const payloadAddress = (
      await _DRE.deployments.get('AssetListingGUni')
    ).address;
    console.log(payloadAddress)
    const executeSignature = 'execute()';
    const executeCallData = "0x";

    const gov = (await getContractAt(
      _DRE,
      'IAaveGovernanceV2',
      AAVE_GOVERNANCE_V2 || ''
    )) as IAaveGovernanceV2;
    const ipfsEncoded = `0x${bs58.decode(IPFS_HASH).slice(2).toString('hex')}`;
      const tx = await gov
        .connect(proposer)
        .populateTransaction
        .create(
          AAVE_SHORT_EXECUTOR,
          [payloadAddress],
          ['0'],
          [executeSignature],
          [executeCallData],
          [true],
          ipfsEncoded
        )

    console.log("Your Proposal:", tx);

    await (await proposer.sendTransaction(tx)).wait()
  });