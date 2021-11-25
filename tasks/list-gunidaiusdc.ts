import { task } from 'hardhat/config';
import '@nomiclabs/hardhat-ethers';
import { getContractAt } from '@nomiclabs/hardhat-ethers/dist/src/helpers';
import { config } from 'dotenv';
import { IAaveGovernanceV2 } from '../types/IAaveGovernanceV2';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const bs58 = require('bs58');

config();

task('create:proposal-new-asset:gunidaiusdc', 'Get the calldata to make a proposal to list G-UNI DAI/USDC')
  // eslint-disable-next-line no-empty-pattern
  .setAction(async ({}, _DRE: any) => {
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
      ENABLE_STABLE_BORROW,
      IPFS_HASH,
      CHAINLINK_ORACLE_PROXY,
      AAVE_GOVERNANCE_V2 = '0xEC568fffba86c094cf06b22134B23074DFE2252c', // mainnet
      AAVE_SHORT_EXECUTOR = '0xee56e2b3d491590b5b31738cc34d5232f378a8d5', // mainnet
      AAVE_PRICE_ORACLE_V2 = '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9' // mainnet
    } = process.env;
    if (
      !TOKEN ||
      !ATOKEN ||
      !STABLE_DEBT_TOKEN ||
      !VARIABLE_DEBT_TOKEN ||
      !INTEREST_STRATEGY ||
      !LTV ||
      !LIQUIDATION_BONUS ||
      !LIQUIDATION_THRESHOLD ||
      !DECIMALS ||
      (ENABLE_BORROW !== 'true' && ENABLE_BORROW !== 'false') ||
      (ENABLE_AS_COLLATERAL !== 'true' && ENABLE_AS_COLLATERAL !== 'false') ||
      (ENABLE_STABLE_BORROW !== 'true' && ENABLE_STABLE_BORROW !== 'false') ||
      !IPFS_HASH ||
      !CHAINLINK_ORACLE_PROXY||
      !AAVE_GOVERNANCE_V2 ||
      !AAVE_SHORT_EXECUTOR ||
      ! AAVE_PRICE_ORACLE_V2 ||
      !RESERVE_FACTOR
    ) {
      throw new Error('You have not set correctly the .env file, make sure to read the README.md');
    }
    const proposer = (await _DRE.ethers.getSigners())[0];
    const genericPayloadAddress = (
      await _DRE.deployments.get('AssetListingProposalGenericExecutor')
    ).address;
    console.log(genericPayloadAddress)
    const executeSignature =
      'execute(address,address,address,address,address,uint256,uint256,uint256,uint256,uint8,bool,bool,bool)';
    const executeCallData = _DRE.ethers.utils.defaultAbiCoder.encode(
      [
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
        ENABLE_STABLE_BORROW === 'true',
        ENABLE_AS_COLLATERAL === 'true',
      ]
    );

    // Set the Chainlink oracle address 
    const setAssetSignature = 'setAssetSources(address[],address[])';
    const setAssetCallData = _DRE.ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'address[]'],
      [[TOKEN], [CHAINLINK_ORACLE_PROXY]]
    );

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
          [genericPayloadAddress, AAVE_PRICE_ORACLE_V2],
          ['0', '0'],
          [executeSignature, setAssetSignature],
          [executeCallData, setAssetCallData],
          [true, false],
          ipfsEncoded
        )

    console.log("Your Proposal:", tx);

    await (await proposer.sendTransaction(tx)).wait()
  });