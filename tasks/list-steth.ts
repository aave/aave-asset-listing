import readline from 'readline';
import { getContractAt } from '@nomiclabs/hardhat-ethers/dist/src/helpers';
import { config } from 'dotenv';
import { task } from 'hardhat/config';
import { HardhatRuntimeEnvironment, TaskArguments } from 'hardhat/types';
import bs58 from 'bs58';

config();

task('create:proposal-new-asset:steth', 'Creates a proposal to list stETH')
  .addFlag('dryrun', 'if provided, only generates the transaction without submitting it onchain')
  .setAction(async (args: TaskArguments, _DRE: HardhatRuntimeEnvironment) => {
    if (args['dryrun']) {
      console.log('The script is running in dry run mode. Transactions will not be sent.');
    }
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
      AAVE_PRICE_ORACLE_V2 = '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9', // mainnet
      ASSET_LISTING_EXECUTOR = '0xe775A3A0A1cdc50bD48d5F47c442A0a4F5F24473', // mainnet AssetListingProposalGenericExecutor
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
      !CHAINLINK_ORACLE_PROXY ||
      !AAVE_GOVERNANCE_V2 ||
      !AAVE_SHORT_EXECUTOR ||
      !AAVE_PRICE_ORACLE_V2 ||
      !RESERVE_FACTOR ||
      !ASSET_LISTING_EXECUTOR
    ) {
      throw new Error('You have not set correctly the .env file, make sure to read the README.md');
    }
    const [proposer] = await _DRE.ethers.getSigners();
    const executeSignature =
      'execute(address,address,address,address,address,uint256,uint256,uint256,uint256,uint8,bool,bool,bool)';
    const assetListingProposalGenericExecutorExecuteCallData = _DRE.ethers.utils.defaultAbiCoder.encode(
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
    const setAssetSourcesSignature = 'setAssetSources(address[],address[])';
    const setAssetSourceSignatureCallData = _DRE.ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'address[]'],
      [[TOKEN], [CHAINLINK_ORACLE_PROXY]]
    );
    const gov = await getContractAt(_DRE, 'IAaveGovernanceV2', AAVE_GOVERNANCE_V2);
    const ipfsEncoded = `0x${bs58.decode(IPFS_HASH).slice(2).toString('hex')}`;
    const tx = await gov
      .connect(proposer)
      .populateTransaction.create(
        AAVE_SHORT_EXECUTOR,
        [ASSET_LISTING_EXECUTOR, AAVE_PRICE_ORACLE_V2],
        ['0', '0'],
        [executeSignature, setAssetSourcesSignature],
        [assetListingProposalGenericExecutorExecuteCallData, setAssetSourceSignatureCallData],
        [true, false],
        ipfsEncoded
      );
    console.log('Proposal Transaction:', tx);

    // if the transaction is running in dry run mode, tries to call it locally to check
    // that it will pass in the "battle" run
    if (args['dryrun']) {
      try {
        console.log('Running transaction locally...');
        await proposer.call(tx);
        console.log('Transaction passed!');
      } catch (error) {
        console.error('Transaction seems to be failed!');
        if (error instanceof Error) {
          console.error('Next error occurred on transaction call: ', error.message);
        }
      }
      return;
    }

    if (process.env.PROMPT === 'true') {
      await promptToProceed();
    }

    console.log('Sending transaction...');
    const receipt = await proposer.sendTransaction(tx).then((tx) => tx.wait());
    console.log('Proposal submitted in:', receipt.transactionHash);
  });

const promptToProceed = () => {
  const rdl = readline.createInterface(process.stdin, process.stdout);
  return new Promise<void>((resolve) => {
    rdl.question('Proceed? y/n:\n', (answer) => {
      rdl.close();
      if (['y', 'yes'].includes(answer)) {
        return resolve();
      } else if (!['n', 'no'].includes(answer)) {
        console.log("Please respond with 'yes' or 'no'");
      }
      process.exit();
    });
  });
};
