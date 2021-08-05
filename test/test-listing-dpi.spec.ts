import path from 'path';
import { expect } from 'chai';
import { config } from 'dotenv';

import rawBRE, { ethers } from 'hardhat';

import { BigNumber } from 'ethers';
import { parseEther } from 'ethers/lib/utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { JsonRpcSigner } from '@ethersproject/providers';
import {
  evmSnapshot,
  increaseTime,
  evmRevert,
  latestBlock,
  advanceBlockTo,
  impersonateAccountsHardhat,
  MAX_UINT_AMOUNT,
} from './utils/utils';
import { parsePoolData } from './utils/listing';
import { IAaveGovernanceV2 } from '../types/IAaveGovernanceV2';
import { IAaveOracle } from '../types/IAaveOracle';
import { ILendingPool } from '../types/ILendingPool';
import { SelfdestructTransferFactory } from '../types/SelfdestructTransferFactory';
import { IERC20 } from '../types/IERC20';

config({ path: path.resolve(process.cwd(), '.dpi.env') });

const AAVE_LENDING_POOL = '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9'; // mainnet
const VOTING_DURATION = 19200;

const AAVE_HOLDER = '0x25f2226b597e8f9514b3f68f00f494cf4f286491'; // mainnet
const AAVE_TOKEN = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9'; // mainnet

const DPI_HOLDER = '0x4a3e950c35c6d9c2d8f5F0a6CC03aF9942134840'; // mainnet
const AAVE_PRICE_ORACLE_V2 = '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9'; // mainnet

const DAI_TOKEN = '0x6b175474e89094c44da98b954eedeac495271d0f'; // mainnet
const DAI_HOLDER = '0x72aabd13090af25dbb804f84de6280c697ed1150'; // mainnet

const ERRORS = {
  NO_BORROW: '7',
  NO_COLLATERAL_BALANCE: '9',
  NO_STABLE_BORROW: '12',
};

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
  IPFS_HASH,
  AAVE_GOVERNANCE_V2 = '0xEC568fffba86c094cf06b22134B23074DFE2252c', // mainnet
  AAVE_SHORT_EXECUTOR = '0xee56e2b3d491590b5b31738cc34d5232f378a8d5', // mainnet
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
  !IPFS_HASH ||
  !AAVE_GOVERNANCE_V2 ||
  !AAVE_SHORT_EXECUTOR ||
  !RESERVE_FACTOR
) {
  throw new Error('You have not set correctly the .dpi.env file, make sure to read the README.md');
}

describe('Deploy DPI assets with different params', () => {
  let aaveHolder: JsonRpcSigner;
  let dpiHolder: JsonRpcSigner;
  let daiHolder: JsonRpcSigner;
  let proposer: SignerWithAddress;
  let gov: IAaveGovernanceV2;
  let pool: ILendingPool;
  let oracle: IAaveOracle;
  let AAVE: IERC20;
  let DPI: IERC20;
  let DAI: IERC20;
  let aDPI: IERC20;
  let stableDebt: IERC20;
  let variableDebt: IERC20;
  let proposal: BigNumber;
  let snapshotId: string;

  before(async () => {

    [proposer] = await rawBRE.ethers.getSigners();
    // send ether to the AAVE_WHALE, which is a non payable contract. Via selfdestruct
    await rawBRE.deployments.deploy('SelfdestructTransfer', { from: proposer.address });
    let selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
    await (
      await selfDestructContract.destroyAndTransfer(AAVE_HOLDER, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();
    selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
    await (
      await selfDestructContract.destroyAndTransfer(DPI_HOLDER, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();
    await impersonateAccountsHardhat([AAVE_HOLDER, DPI_HOLDER, DAI_HOLDER]);

    // impersonating holders
    aaveHolder = ethers.provider.getSigner(AAVE_HOLDER);
    dpiHolder = ethers.provider.getSigner(DPI_HOLDER);
    daiHolder = ethers.provider.getSigner(DAI_HOLDER);

    //getting main entry point contracts
    gov = (await ethers.getContractAt(
      'IAaveGovernanceV2',
      AAVE_GOVERNANCE_V2,
      proposer
    )) as IAaveGovernanceV2;
    pool = (await ethers.getContractAt(
      'ILendingPool',
      AAVE_LENDING_POOL,
      proposer
    )) as ILendingPool;

    // getting tokens used for tests
    AAVE = (await ethers.getContractAt('IERC20', AAVE_TOKEN, aaveHolder)) as IERC20;
    DAI = (await ethers.getContractAt('IERC20', DAI_TOKEN, daiHolder)) as IERC20;
    DPI = (await ethers.getContractAt('IERC20', TOKEN, dpiHolder)) as IERC20;
    oracle = (await ethers.getContractAt('IAaveOracle', AAVE_PRICE_ORACLE_V2)) as IAaveOracle;

    console.log(DPI.address);

    // Give DPI to whale
    await (
      await AAVE.transfer(
        proposer.address,
        (await AAVE.balanceOf(AAVE_HOLDER)).sub(parseEther('10'))
      )
    ).wait();

    // giving just a bit of DAI to DPI holder to pay for interest later
    await (await DAI.transfer(DPI_HOLDER, parseEther('10'))).wait();
    await (
      await DPI.transfer(
        proposer.address,
        (await DPI.balanceOf(DPI_HOLDER)).sub(parseEther('10000'))
      )
    ).wait();

    // get next proposal id
    proposal = await gov.getProposalsCount();

    // create proposal
    await rawBRE.run('create:proposal-new-asset:dpi', {});

    // voting, queuing proposals
    await rawBRE.ethers.provider.send('evm_mine', [0]);
    await (await gov.submitVote(proposal, true)).wait();
    await advanceBlockTo((await latestBlock()) + VOTING_DURATION + 1);
    await (await gov.queue(proposal)).wait();
    const proposalState = await gov.getProposalState(proposal);
    expect(proposalState).to.be.equal(5);
    await increaseTime(86400 + 10);

    snapshotId = await evmSnapshot();
  });

  it('Should list correctly an asset: borrow on, collateral on, stable borrow on', async () => {

    // setting the assets, executing the proposal
    await (await gov.execute(proposal)).wait();
    const proposalState = await gov.getProposalState(proposal);
    expect(proposalState).to.be.equal(7);

    // fetching and testing pool config data for DPI
    const {
      configuration: { data },
      aTokenAddress,
      stableDebtTokenAddress,
      variableDebtTokenAddress,
    } = await pool.getReserveData(TOKEN);
    const poolData = parsePoolData(data);

    expect(poolData).to.be.eql({
      reserveFactor: RESERVE_FACTOR,
      reserved: '0',
      stableRateEnabled: '0',
      borrowingEnabled: '1',
      reserveFrozen: '0',
      reserveActive: '1',
      decimals: DECIMALS,
      liquidityBonus: LIQUIDATION_BONUS,
      LiquidityThreshold: LIQUIDATION_THRESHOLD,
      LTV,
    });

    // preparing for tests.
    aDPI = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    const initialDpiHolderBalance = await DPI.balanceOf(DPI_HOLDER);
    await (await DPI.connect(dpiHolder).approve(pool.address, parseEther('200000'))).wait();
    await (await AAVE.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

    // AAVE deposit by proposer
    await (await pool.deposit(AAVE.address, parseEther('100'), proposer.address, 0)).wait();

    // DPI deposit by DPI holder
    await (
      await pool.connect(dpiHolder).deposit(DPI.address, parseEther('1000'), DPI_HOLDER, 0)
    ).wait();
    expect(await aDPI.balanceOf(DPI_HOLDER)).to.be.equal(parseEther('1000'));

    // DPI holder able to borrow DAI against DPI
    await (
      await pool.connect(dpiHolder).borrow(DAI.address, parseEther('1'), 2, 0, DPI_HOLDER)
    ).wait();

    // proposer able to borrow DPI variable against AAVE
    await (
      await pool.connect(proposer).borrow(DPI.address, parseEther('10'), 2, 0, proposer.address)
    ).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('10'));

    // proposer not able to borrow DPI stable against AAVE
    await expect(
      pool.borrow(DPI.address, parseEther('10'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_STABLE_BORROW);
    increaseTime(40000);

    // proposer able to repay DPI variable
    await (await DPI.connect(proposer).approve(pool.address, parseEther('100000'))).wait();
    await (await pool.repay(DPI.address, MAX_UINT_AMOUNT, 2, proposer.address)).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('0'));

    // DPI holder able to repay DAI with interests
    await (await DAI.connect(dpiHolder).approve(pool.address, MAX_UINT_AMOUNT)).wait();
    await (await pool.connect(dpiHolder).repay(DAI.address, MAX_UINT_AMOUNT, 2, DPI_HOLDER)).wait();

    // DPI holder able to withdraw DPI with interest
    await (await pool.connect(dpiHolder).withdraw(DPI.address, MAX_UINT_AMOUNT, DPI_HOLDER)).wait();
    expect(await DPI.balanceOf(DPI_HOLDER)).to.be.gt(initialDpiHolderBalance);
  });

  it('Oracle should return a non zero DPI price', async () => {
    expect(await oracle.getAssetPrice(TOKEN)).to.be.gt('0');
  });
});
