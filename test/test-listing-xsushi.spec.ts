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
import { IERC20 } from '../types/IERC20';

config({ path: path.resolve(process.cwd(), 'xsushi.env') });

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
  throw new Error('You have not set correctly the .env file, make sure to read the README.md');
}

const AAVE_LENDING_POOL = '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9';
const VOTING_DURATION = 19200;

const AAVE_WHALE = '0x25f2226b597e8f9514b3f68f00f494cf4f286491';
const AAVE_TOKEN = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';

const XSUSHI_HOLDER = '0xb8fc6fd16ab5f3b6652c6580c8b6208ddbd8b8a5';
const AAVE_ORACLE_OWNER = '0xb9062896ec3a615a4e4444df183f0531a77218ae';

const DAI_TOKEN = '0x6b175474e89094c44da98b954eedeac495271d0f';
const DAI_HOLDER = '0x72aabd13090af25dbb804f84de6280c697ed1150';

const ERRORS = {
  NO_BORROW: '7',
  NO_COLLATERAL_BALANCE: '9',
  NO_STABLE_BORROW: '12',
};

describe('Deploy XSUSHI assets with different params', () => {
  let whale: JsonRpcSigner;
  let XSUSHIHolder: JsonRpcSigner;
  let daiHolder: JsonRpcSigner;
  let proposer: SignerWithAddress;
  let gov: IAaveGovernanceV2;
  let pool: ILendingPool;
  let aave: IERC20;
  let XSUSHI: IERC20;
  let dai: IERC20;
  let aCrv: IERC20;
  let stableDebt: IERC20;
  let variableDebt: IERC20;
  let proposalOffOffOff: BigNumber;
  let proposalOnOffOff: BigNumber;
  let proposalOnOnOff: BigNumber;
  let proposalOnOnOn: BigNumber;
  let snapshotId: string;
  before(async () => {
    [proposer] = await rawBRE.ethers.getSigners();

    // send ether to the AAVE_WHALE, which is a non payable contract. Via selfdestruct
    await rawBRE.deployments.deploy('SelfdestructTransfer', { from: proposer.address });
    const selfDestructAddress = (await rawBRE.deployments.get('SelfdestructTransfer')).address;
    const selfDestructContract = await ethers.getContractAt(
      'SelfdestructTransfer',
      selfDestructAddress
    );
    await (
      await selfDestructContract.destroyAndTransfer(AAVE_WHALE, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();
    await impersonateAccountsHardhat([AAVE_WHALE, XSUSHI_HOLDER, AAVE_ORACLE_OWNER, DAI_HOLDER]);

    // impersonating holders
    whale = ethers.provider.getSigner(AAVE_WHALE);
    XSUSHIHolder = ethers.provider.getSigner(XSUSHI_HOLDER);
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
    aave = (await ethers.getContractAt('IERC20', AAVE_TOKEN, whale)) as IERC20;
    dai = (await ethers.getContractAt('IERC20', DAI_TOKEN, daiHolder)) as IERC20;
    XSUSHI = (await ethers.getContractAt('IERC20', TOKEN, XSUSHIHolder)) as IERC20;

    // give XSUSHI to whale
    await (
      await aave.transfer(
        proposer.address,
        (await aave.balanceOf(AAVE_WHALE)).sub(parseEther('10000'))
      )
    ).wait();

    // giving just a bit of Dai to Crv holder to pay for interest later
    await (await dai.transfer(XSUSHI_HOLDER, parseEther('10'))).wait();
    await (
      await XSUSHI.transfer(
        proposer.address,
        (await XSUSHI.balanceOf(XSUSHI_HOLDER)).sub(parseEther('10000'))
      )
    ).wait();

    // deploying the payload
    await rawBRE.ethers.provider.send('evm_mine', [0]);
    await rawBRE.deployments.deploy('AssetListingProposalGenericExecutor', {
      from: proposer.address,
      gasLimit: 4000000,
      gasPrice: BigNumber.from('75000000000'),
      args: [],
    });

    // process env is used during create proposal scripts
    process.env = {
      ...process.env,
      ENABLE_BORROW: 'false',
      ENABLE_AS_COLLATERAL: 'false',
      ENABLE_STABLE_BORROW: 'false',
    };
    // making 4 different proposals
    // borrow off, collateral off, stable borrow off
    // borrow on, collateral off, stable borrow off
    // borrow on, collateral on, stable borrow off
    // borrow on, collateral on, stable borrow on
    proposalOffOffOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset');
    process.env = { ...process.env, ENABLE_BORROW: 'true' };
    proposalOnOffOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset');
    process.env = { ...process.env, ENABLE_AS_COLLATERAL: 'true' };
    proposalOnOnOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset');
    process.env = { ...process.env, ENABLE_STABLE_BORROW: 'true' };
    proposalOnOnOn = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset');

    // voting, queuing proposals
    await rawBRE.ethers.provider.send('evm_mine', [0]);
    await (await gov.submitVote(proposalOffOffOff, true)).wait();
    await (await gov.submitVote(proposalOnOffOff, true)).wait();
    await (await gov.submitVote(proposalOnOnOff, true)).wait();
    await (await gov.submitVote(proposalOnOnOn, true)).wait();
    await advanceBlockTo((await latestBlock()) + VOTING_DURATION + 1);
    await (await gov.queue(proposalOffOffOff)).wait();
    await (await gov.queue(proposalOnOffOff)).wait();
    await (await gov.queue(proposalOnOnOff)).wait();
    await (await gov.queue(proposalOnOnOn)).wait();
    let proposalState = await gov.getProposalState(proposalOffOffOff);
    expect(proposalState).to.be.equal(5);
    proposalState = await gov.getProposalState(proposalOnOffOff);
    expect(proposalState).to.be.equal(5);
    proposalState = await gov.getProposalState(proposalOnOnOff);
    expect(proposalState).to.be.equal(5);

    await increaseTime(86400 + 10);
    snapshotId = await evmSnapshot();
  });
  afterEach(async () => {
    evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });
  it('Should list correctly an asset: borrow off, collateral off, stable rate off', async () => {
    await (await gov.execute(proposalOffOffOff)).wait();
    const proposalState = await gov.getProposalState(proposalOffOffOff);
    expect(proposalState).to.be.equal(7);
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
      borrowingEnabled: '0',
      reserveFrozen: '0',
      reserveActive: '1',
      decimals: DECIMALS,
      liquidityBonus: '0',
      LiquidityThreshold: '0',
      LTV: '0',
    });

    aCrv = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    await (await XSUSHI.connect(proposer).approve(pool.address, parseEther('2000'))).wait();
    await (await aave.connect(proposer).approve(pool.address, parseEther('2000'))).wait();
    await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();
    await (await pool.deposit(XSUSHI.address, parseEther('100'), proposer.address, 0)).wait();
    expect(await aCrv.balanceOf(proposer.address)).to.be.equal(parseEther('100'));

    // preparing for tests.
    aCrv = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    await (await XSUSHI.connect(XSUSHIHolder).approve(pool.address, parseEther('200000'))).wait();
    await (await aave.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

    // AAVE deposit by proposer
    await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();

    // XSUSHI deposit by XSUSHI holder
    await (
      await pool.connect(XSUSHIHolder).deposit(XSUSHI.address, parseEther('1000'), XSUSHI_HOLDER, 0)
    ).wait();
    expect(await aCrv.balanceOf(XSUSHI_HOLDER)).to.be.equal(parseEther('1000'));

    // XSUSHI holder not able to borrow DAI against XSUSHI
    await expect(
      pool.connect(XSUSHIHolder).borrow(dai.address, parseEther('1'), 2, 0, XSUSHI_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

    // proposer not able to borrow XSUSHI variable against AAVE
    await expect(
      pool.connect(proposer).borrow(XSUSHI.address, parseEther('10'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    // proposer not able to borrow XSUSHI stable against AAVE
    await expect(
      pool.borrow(XSUSHI.address, parseEther('5'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);
  });
  it('Should list correctly an asset: borrow on, collateral off, stable borrow off', async () => {
    await (await gov.execute(proposalOnOffOff)).wait();
    const proposalState = await gov.getProposalState(proposalOnOffOff);
    expect(proposalState).to.be.equal(7);
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
      liquidityBonus: '0',
      LiquidityThreshold: '0',
      LTV: '0',
    });

    // preparing for tests.
    aCrv = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    await (await XSUSHI.connect(XSUSHIHolder).approve(pool.address, parseEther('200000'))).wait();
    await (await aave.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

    // AAVE deposit by proposer
    await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();

    // XSUSHI deposit by XSUSHI holder
    await (
      await pool.connect(XSUSHIHolder).deposit(XSUSHI.address, parseEther('1000'), XSUSHI_HOLDER, 0)
    ).wait();
    expect(await aCrv.balanceOf(XSUSHI_HOLDER)).to.be.equal(parseEther('1000'));

    // XSUSHI holder not able to borrow DAI against XSUSHI
    await expect(
      pool.connect(XSUSHIHolder).borrow(dai.address, parseEther('1'), 2, 0, XSUSHI_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

    // proposer able to borrow XSUSHI variable against AAVE
    await (
      await pool.connect(proposer).borrow(XSUSHI.address, parseEther('10'), 2, 0, proposer.address)
    ).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('10'));

    // proposer not able to borrow XSUSHI stable against AAVE
    await expect(
      pool.borrow(XSUSHI.address, parseEther('5'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_STABLE_BORROW);
    increaseTime(40000);

    // proposer able to repay XSUSHI variable
    await (await XSUSHI.connect(proposer).approve(pool.address, parseEther('100000'))).wait();
    await (await pool.repay(XSUSHI.address, MAX_UINT_AMOUNT, 2, proposer.address)).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('0'));
  });
  it('Should list correctly an asset: borrow on, collateral on, stable rate off', async () => {
    await (await gov.execute(proposalOnOnOff)).wait();
    const proposalState = await gov.getProposalState(proposalOnOnOff);
    expect(proposalState).to.be.equal(7);
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
    aCrv = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    const initCrvHolderBalance = await XSUSHI.balanceOf(XSUSHI_HOLDER);
    await (await XSUSHI.connect(XSUSHIHolder).approve(pool.address, parseEther('200000'))).wait();
    await (await aave.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

    // AAVE deposit by proposer
    await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();

    // XSUSHI deposit by XSUSHI holder
    await (
      await pool.connect(XSUSHIHolder).deposit(XSUSHI.address, parseEther('1000'), XSUSHI_HOLDER, 0)
    ).wait();
    expect(await aCrv.balanceOf(XSUSHI_HOLDER)).to.be.equal(parseEther('1000'));

    // XSUSHI holder able to borrow DAI against XSUSHI
    await (
      await pool.connect(XSUSHIHolder).borrow(dai.address, parseEther('1'), 2, 0, XSUSHI_HOLDER)
    ).wait();

    // proposer able to borrow XSUSHI variable against AAVE
    await (
      await pool.connect(proposer).borrow(XSUSHI.address, parseEther('10'), 2, 0, proposer.address)
    ).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('10'));

    // proposer not able to borrow XSUSHI stable against AAVE
    await expect(
      pool.borrow(XSUSHI.address, parseEther('5'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_STABLE_BORROW);
    increaseTime(40000);

    // proposer able to repay XSUSHI variable
    await (await XSUSHI.connect(proposer).approve(pool.address, parseEther('100000'))).wait();
    await (await pool.repay(XSUSHI.address, MAX_UINT_AMOUNT, 2, proposer.address)).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('0'));

    // XSUSHI holder able to repay DAI with  interests
    await (await dai.connect(XSUSHIHolder).approve(pool.address, MAX_UINT_AMOUNT)).wait();
    await (await pool.connect(XSUSHIHolder).repay(dai.address, MAX_UINT_AMOUNT, 2, XSUSHI_HOLDER)).wait();

    // XSUSHI holder able to withdraw XSUSHI with interest
    await (await pool.connect(XSUSHIHolder).withdraw(XSUSHI.address, MAX_UINT_AMOUNT, XSUSHI_HOLDER)).wait();
    expect(await XSUSHI.balanceOf(XSUSHI_HOLDER)).to.be.gt(initCrvHolderBalance);
  });
  it('Should list correctly an asset: borrow on, collateral on, stable rate on', async () => {
    // setting the assets, executing the proposal
    await (await gov.execute(proposalOnOnOn)).wait();
    const proposalState = await gov.getProposalState(proposalOnOnOn);
    expect(proposalState).to.be.equal(7);

    // fetching and testing pool config data for XSUSHI
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
      stableRateEnabled: '1',
      borrowingEnabled: '1',
      reserveFrozen: '0',
      reserveActive: '1',
      decimals: DECIMALS,
      liquidityBonus: LIQUIDATION_BONUS,
      LiquidityThreshold: LIQUIDATION_THRESHOLD,
      LTV,
    });

    // preparing for tests.
    aCrv = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    const initCrvHolderBalance = await XSUSHI.balanceOf(XSUSHI_HOLDER);
    await (await XSUSHI.connect(XSUSHIHolder).approve(pool.address, parseEther('200000'))).wait();
    await (await aave.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

    // AAVE deposit by proposer
    await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();

    // XSUSHI deposit by XSUSHI holder
    await (
      await pool.connect(XSUSHIHolder).deposit(XSUSHI.address, parseEther('1000'), XSUSHI_HOLDER, 0)
    ).wait();
    expect(await aCrv.balanceOf(XSUSHI_HOLDER)).to.be.equal(parseEther('1000'));

    // XSUSHI holder able to borrow DAI against XSUSHI
    await (
      await pool.connect(XSUSHIHolder).borrow(dai.address, parseEther('1'), 2, 0, XSUSHI_HOLDER)
    ).wait();

    // proposer able to borrow XSUSHI variable against AAVE
    await (
      await pool.connect(proposer).borrow(XSUSHI.address, parseEther('10'), 2, 0, proposer.address)
    ).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('10'));

    // proposer able to borrow XSUSHI stable against AAVE
    await (await pool.borrow(XSUSHI.address, parseEther('5'), 1, 0, proposer.address)).wait();
    expect(await stableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('5'));
    increaseTime(40000);

    // proposer able to repay XSUSHI variable
    await (await XSUSHI.connect(proposer).approve(pool.address, parseEther('100000'))).wait();
    await (await pool.repay(XSUSHI.address, MAX_UINT_AMOUNT, 2, proposer.address)).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('0'));

    // proposer able to repay XSUSHI sttable
    await (await pool.repay(XSUSHI.address, MAX_UINT_AMOUNT, 1, proposer.address)).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('0'));

    // XSUSHI holder able to repay DAI with  interests
    await (await dai.connect(XSUSHIHolder).approve(pool.address, MAX_UINT_AMOUNT)).wait();
    await (await pool.connect(XSUSHIHolder).repay(dai.address, MAX_UINT_AMOUNT, 2, XSUSHI_HOLDER)).wait();

    // XSUSHI holder able to withdraw XSUSHI with interest
    await (await pool.connect(XSUSHIHolder).withdraw(XSUSHI.address, MAX_UINT_AMOUNT, XSUSHI_HOLDER)).wait();
    expect(await XSUSHI.balanceOf(XSUSHI_HOLDER)).to.be.gt(initCrvHolderBalance);
  });
});
