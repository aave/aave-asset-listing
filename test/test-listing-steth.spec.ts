import path from 'path';
import { expect } from 'chai';
import { config } from 'dotenv';

import rawBRE, { ethers } from 'hardhat';

import { BigNumber } from '@ethersproject/bignumber';
import { parseEther } from '@ethersproject/units';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { JsonRpcSigner } from '@ethersproject/providers';
import { Contract, ContractTransaction } from '@ethersproject/contracts';
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
import { IERC20 } from '../types/IERC20';
import { ILendingPool } from '../types/ILendingPool';

config({ path: path.resolve(process.cwd(), '.steth.env') });

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
  TOKEN_HOLDER: STETH_HOLDER,
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
  !RESERVE_FACTOR ||
  !STETH_HOLDER
) {
  throw new Error('You have not set correctly the .env file, make sure to read the README.md');
}

const AAVE_LENDING_POOL = '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9';
const VOTING_DURATION = 19200;

const AAVE_TOKEN = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';
const AAVE_WHALE = '0x25f2226b597e8f9514b3f68f00f494cf4f286491';

const DAI_TOKEN = '0x6b175474e89094c44da98b954eedeac495271d0f';
const DAI_HOLDER = '0x72aabd13090af25dbb804f84de6280c697ed1150';

const ERRORS = {
  NO_BORROW: '7',
  NO_COLLATERAL_BALANCE: '9',
  NO_STABLE_BORROW: '12',
  STETH_BORROWING_FORBIDDEN: 'CONTRACT_NOT_ACTIVE',
};

describe('Test STETH asset listing with different params', () => {
  let whale: JsonRpcSigner;
  let stEthHolder: JsonRpcSigner;
  let daiHolder: JsonRpcSigner;
  let proposer: SignerWithAddress;
  let gov: IAaveGovernanceV2;
  let pool: ILendingPool;
  let aave: IERC20;
  let stEth: IERC20;
  let dai: IERC20;
  let proposalOffOffOff: BigNumber;
  let proposalOffOnOff: BigNumber;
  let proposalOnOffOff: BigNumber;
  let proposalOnOnOff: BigNumber;
  let proposalOnOnOn: BigNumber;
  let snapshotId: string;

  before(async () => {
    [proposer] = await rawBRE.ethers.getSigners();

    // send ether to the AAVE_WHALE, which is a non payable contract. Via selfdestruct
    const { address: selfDestructAddress } = await rawBRE.deployments.deploy(
      'SelfdestructTransfer',
      { from: proposer.address }
    );
    const selfDestructContract: Contract = await ethers.getContractAt(
      'SelfdestructTransfer',
      selfDestructAddress
    );
    await waitForTx(
      selfDestructContract.destroyAndTransfer(AAVE_WHALE, {
        value: ethers.utils.parseEther('1'),
      })
    );

    // impersonating holders
    await impersonateAccountsHardhat([AAVE_WHALE, STETH_HOLDER, DAI_HOLDER]);
    whale = ethers.provider.getSigner(AAVE_WHALE);
    stEthHolder = ethers.provider.getSigner(STETH_HOLDER);
    daiHolder = ethers.provider.getSigner(DAI_HOLDER);

    // getting main entry point contracts
    gov = await getContractAt<IAaveGovernanceV2>('IAaveGovernanceV2', AAVE_GOVERNANCE_V2, proposer);
    pool = await getContractAt<ILendingPool>('ILendingPool', AAVE_LENDING_POOL);

    // getting tokens used for tests
    aave = await getContractAt<IERC20>('IERC20', AAVE_TOKEN, whale);
    dai = await getContractAt<IERC20>('IERC20', DAI_TOKEN, daiHolder);
    stEth = await getContractAt<IERC20>('IERC20', TOKEN, stEthHolder);

    // transfer AAVE tokens to proposer to have propositional power
    await waitForTx(
      aave.transfer(
        proposer.address,
        await aave.balanceOf(AAVE_WHALE).then((balance) => balance.sub(parseEther('10000')))
      )
    );

    // giving just a bit of DAI to stETH holder to pay for interest later
    await waitForTx(dai.transfer(STETH_HOLDER, parseEther('10')));

    // giving a bit of stETH to proposer to have to deposit
    await waitForTx(stEth.transfer(proposer.address, parseEther('10')));

    // making 4 different proposals
    // borrow off, collateral off, stable borrow off
    process.env = { ...process.env, ENABLE_AS_COLLATERAL: 'false' };
    proposalOffOffOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:steth');

    // borrow off, collateral on, stable borrow off (actual stETH listing params)
    process.env = { ...process.env, ENABLE_AS_COLLATERAL: 'true' };
    proposalOffOnOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:steth');

    // borrow on, collateral off stable borrow off
    process.env = { ...process.env, ENABLE_BORROW: 'true', ENABLE_AS_COLLATERAL: 'false' };
    proposalOnOffOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:steth');

    // borrow on, collateral on, stable borrow off
    process.env = { ...process.env, ENABLE_AS_COLLATERAL: 'true' };
    proposalOnOnOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:steth');

    // borrow on, collateral on, stable borrow on
    process.env = { ...process.env, ENABLE_STABLE_BORROW: 'true' };
    proposalOnOnOn = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:steth');

    // voting, queuing proposals
    await rawBRE.ethers.provider.send('evm_mine', [0]);
    await waitForTx(gov.submitVote(proposalOffOffOff, true));
    await waitForTx(gov.submitVote(proposalOffOnOff, true));
    await waitForTx(gov.submitVote(proposalOnOffOff, true));
    await waitForTx(gov.submitVote(proposalOnOnOff, true));
    await waitForTx(gov.submitVote(proposalOnOnOn, true));
    await advanceBlockTo(
      await latestBlock().then((blockNumber) => blockNumber + VOTING_DURATION + 1)
    );
    await waitForTx(gov.queue(proposalOffOffOff));
    await waitForTx(gov.queue(proposalOffOnOff));
    await waitForTx(gov.queue(proposalOnOffOff));
    await waitForTx(gov.queue(proposalOnOnOff));
    await waitForTx(gov.queue(proposalOnOnOn));
    expect(await gov.getProposalState(proposalOffOffOff)).to.be.equal(5);
    expect(await gov.getProposalState(proposalOffOnOff)).to.be.equal(5);
    expect(await gov.getProposalState(proposalOnOffOff)).to.be.equal(5);
    expect(await gov.getProposalState(proposalOnOnOff)).to.be.equal(5);
    expect(await gov.getProposalState(proposalOnOnOn)).to.be.equal(5);

    await increaseTime(86400 + 10);
    snapshotId = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(snapshotId);
    snapshotId = await evmSnapshot();
  });

  it('Should list correctly an asset: borrow off, collateral off, stable rate off', async () => {
    await waitForTx(gov.execute(proposalOffOffOff));
    const proposalState = await gov.getProposalState(proposalOffOffOff);
    expect(proposalState).to.be.equal(7);
    const { configuration, aTokenAddress } = await pool.getReserveData(TOKEN);
    const poolData = parsePoolData(configuration.data);
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

    // preparing for tests
    const astEth = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(stEth.connect(stEthHolder).approve(pool.address, parseEther('100')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // stETH deposit by stETH holder
    await waitForTx(
      pool.connect(stEthHolder).deposit(stEth.address, parseEther('50'), STETH_HOLDER, 0)
    );

    // validate that amount of minted astETH tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the stETH shares mechanic
    assertOneWeiLessOrEqual(await astEth.balanceOf(STETH_HOLDER), parseEther('50'));

    // validate that the transferred amount of stETH tokens is equal to the amount of minted
    // astETH and all minted tokens belong to STETH_HOLDER
    expect(await stEth.balanceOf(astEth.address))
      .to.be.equal(await astEth.totalSupply())
      .and.to.be.equal(await astEth.balanceOf(STETH_HOLDER));

    // stETH holder not able to borrow DAI against stETH
    await expect(
      pool.connect(stEthHolder).borrow(dai.address, parseEther('1'), 2, 0, STETH_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

    // proposer not able to borrow stETH variable against AAVE
    await expect(
      pool.borrow(stEth.address, parseEther('5'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    // proposer not able to borrow stETH stable against AAVE
    await expect(
      pool.borrow(stEth.address, parseEther('2'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);
  });

  it('Should list correctly an asset: borrow off, collateral on, stable borrow off', async () => {
    await waitForTx(gov.execute(proposalOffOnOff));
    const proposalState = await gov.getProposalState(proposalOffOnOff);
    expect(proposalState).to.be.equal(7);
    const { configuration, aTokenAddress } = await pool.getReserveData(TOKEN);
    const poolData = parsePoolData(configuration.data);
    expect(poolData).to.be.eql({
      reserveFactor: RESERVE_FACTOR,
      reserved: '0',
      stableRateEnabled: '0',
      borrowingEnabled: '0',
      reserveFrozen: '0',
      reserveActive: '1',
      decimals: DECIMALS,
      liquidityBonus: LIQUIDATION_BONUS,
      LiquidityThreshold: LIQUIDATION_THRESHOLD,
      LTV,
    });

    // preparing for tests
    const astEth = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(stEth.connect(stEthHolder).approve(pool.address, parseEther('1000')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // validate that before deposit were no minted astETH tokens
    expect(await astEth.totalSupply()).to.be.equal('0');
    expect(await astEth.balanceOf(STETH_HOLDER)).to.be.equal('0');

    // stETH deposit by stETH holder
    await waitForTx(
      pool.connect(stEthHolder).deposit(stEth.address, parseEther('50'), STETH_HOLDER, 0)
    );

    // validate that amount of minted astETH tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the stETH shares mechanic
    assertOneWeiLessOrEqual(await astEth.balanceOf(STETH_HOLDER), parseEther('50'));

    // validate that the transferred amount of stETH tokens is equal to the amount of minted
    // astETH and all minted tokens belong to STETH_HOLDER
    expect(await stEth.balanceOf(astEth.address))
      .to.be.equal(await astEth.totalSupply())
      .and.to.be.equal(await astEth.balanceOf(STETH_HOLDER));

    // stETH holder able to borrow DAI against stETH
    await waitForTx(
      pool.connect(stEthHolder).borrow(dai.address, parseEther('1'), 2, 0, STETH_HOLDER)
    );

    // proposer not able to borrow stETH variable against AAVE
    await expect(
      pool.borrow(stEth.address, parseEther('5'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    // proposer not able to borrow stETH stable against AAVE
    await expect(
      pool.borrow(stEth.address, parseEther('2'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    // stETH holder able to repay DAI with interests
    await waitForTx(dai.connect(stEthHolder).approve(pool.address, MAX_UINT_AMOUNT));
    await waitForTx(pool.connect(stEthHolder).repay(dai.address, MAX_UINT_AMOUNT, 2, STETH_HOLDER));

    // stETH holder able to withdraw stETH
    const stEthHolderStEthBalanceBeforeWithdraw = await stEth.balanceOf(STETH_HOLDER);
    const stEthHolderAstEthBalanceBeforeWithdraw = await astEth.balanceOf(STETH_HOLDER);
    await waitForTx(
      pool.connect(stEthHolder).withdraw(stEth.address, MAX_UINT_AMOUNT, STETH_HOLDER)
    );

    // validate that amount of withdrawn stETH tokens are equal or 1 WEI less than the
    // astETH balance of the STETH_HOLDER before withdrawing. The difference in 1 WEI
    // might happen due to the stETH shares mechanic
    assertOneWeiLessOrEqual(
      await stEth.balanceOf(STETH_HOLDER),
      stEthHolderStEthBalanceBeforeWithdraw.add(stEthHolderAstEthBalanceBeforeWithdraw)
    );

    // validate that on the balance of astETH token stayed the same amount of stETH as astETH
    // total supply and that all this balance belongs to STETH_HOLDER and this balance doesn't
    // exceed 1 WEI. The 1 WEI might stay on balances after transfers due to the stETH
    // shares mechanic
    expect(await astEth.totalSupply())
      .to.be.equal(await astEth.balanceOf(STETH_HOLDER))
      .and.to.be.equal(await stEth.balanceOf(astEth.address))
      .and.to.be.lte('1');
  });

  it('Should list correctly an asset: borrow on, collateral off, stable rate off', async () => {
    await waitForTx(gov.execute(proposalOnOffOff));
    const proposalState = await gov.getProposalState(proposalOnOffOff);
    expect(proposalState).to.be.equal(7);
    const { configuration, aTokenAddress } = await pool.getReserveData(TOKEN);
    const poolData = parsePoolData(configuration.data);
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

    // preparing for tests
    const astEth = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(stEth.connect(stEthHolder).approve(pool.address, parseEther('100')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // stETH deposit by stETH holder
    await waitForTx(
      pool.connect(stEthHolder).deposit(stEth.address, parseEther('50'), STETH_HOLDER, 0)
    );

    // validate that amount of minted astETH tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the stETH shares mechanic
    assertOneWeiLessOrEqual(await astEth.balanceOf(STETH_HOLDER), parseEther('50'));

    // validate that the transferred amount of stETH tokens is equal to the amount of minted
    // astETH and all minted tokens belong to STETH_HOLDER
    expect(await stEth.balanceOf(astEth.address))
      .to.be.equal(await astEth.totalSupply())
      .and.to.be.equal(await astEth.balanceOf(STETH_HOLDER));

    // stETH holder not able to borrow DAI against stETH
    await expect(
      pool.connect(stEthHolder).borrow(dai.address, parseEther('1'), 2, 0, STETH_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

    // proposer not able to borrow stETH variable against AAVE (VariableDebtStETH minting disabled)
    await expect(
      pool.connect(proposer).borrow(stEth.address, parseEther('10'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.STETH_BORROWING_FORBIDDEN);

    // proposer not able to borrow stETH stable against AAVE
    await expect(
      pool.borrow(stEth.address, parseEther('2'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_STABLE_BORROW);
  });

  it('Should list correctly an asset: borrow on, collateral on, stable borrow off', async () => {
    await waitForTx(gov.execute(proposalOnOnOff));
    const proposalState = await gov.getProposalState(proposalOnOnOff);
    expect(proposalState).to.be.equal(7);
    const { configuration, aTokenAddress } = await pool.getReserveData(TOKEN);
    const poolData = parsePoolData(configuration.data);
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

    // preparing for tests
    const astEth = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(stEth.connect(stEthHolder).approve(pool.address, parseEther('1000')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // validate that before deposit were no minted astETH tokens
    expect(await astEth.totalSupply()).to.be.equal('0');
    expect(await astEth.balanceOf(STETH_HOLDER)).to.be.equal('0');

    // stETH deposit by stETH holder
    await waitForTx(
      pool.connect(stEthHolder).deposit(stEth.address, parseEther('0.5'), STETH_HOLDER, 0)
    );

    // validate that amount of minted astETH tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the stETH shares mechanic
    assertOneWeiLessOrEqual(await astEth.balanceOf(STETH_HOLDER), parseEther('0.5'));

    // validate that the transferred amount of stETH tokens is equal to the amount of minted
    // astETH and all minted tokens belong to STETH_HOLDER
    expect(await stEth.balanceOf(astEth.address))
      .to.be.equal(await astEth.totalSupply())
      .and.to.be.equal(await astEth.balanceOf(STETH_HOLDER));

    // stETH holder able to borrow DAI against stETH
    await waitForTx(
      pool.connect(stEthHolder).borrow(dai.address, parseEther('1'), 2, 0, STETH_HOLDER)
    );

    // proposer not able to borrow stETH variable against AAVE (VariableDebtStETH minting disabled)
    await expect(
      pool.connect(proposer).borrow(stEth.address, parseEther('10'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.STETH_BORROWING_FORBIDDEN);

    // proposer not able to borrow stETH stable against AAVE
    await expect(
      pool.borrow(stEth.address, parseEther('2'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_STABLE_BORROW);

    // stETH holder able to repay DAI with interests
    await waitForTx(dai.connect(stEthHolder).approve(pool.address, MAX_UINT_AMOUNT));
    await waitForTx(pool.connect(stEthHolder).repay(dai.address, MAX_UINT_AMOUNT, 2, STETH_HOLDER));

    // stETH holder able to withdraw stETH
    const stEthHolderStEthBalanceBeforeWithdraw = await stEth.balanceOf(STETH_HOLDER);
    const stEthHolderAstEthBalanceBeforeWithdraw = await astEth.balanceOf(STETH_HOLDER);
    await waitForTx(
      pool.connect(stEthHolder).withdraw(stEth.address, MAX_UINT_AMOUNT, STETH_HOLDER)
    );

    // validate that amount of withdrawn stETH tokens are equal or 1 WEI less than the
    // astETH balance of the STETH_HOLDER before withdrawing. The difference in 1 WEI
    // might happen due to the stETH shares mechanic
    assertOneWeiLessOrEqual(
      await stEth.balanceOf(STETH_HOLDER),
      stEthHolderStEthBalanceBeforeWithdraw.add(stEthHolderAstEthBalanceBeforeWithdraw)
    );

    // validate that on the balance of astETH token stayed the same amount of stETH as astETH
    // total supply and that all this balance belongs to STETH_HOLDER and this balance doesn't
    // exceed 1 WEI. The 1 WEI might stay on balances after transfers due to the stETH
    // shares mechanic
    expect(await astEth.totalSupply())
      .to.be.equal(await astEth.balanceOf(STETH_HOLDER))
      .and.to.be.equal(await stEth.balanceOf(astEth.address))
      .and.to.be.lte('1');
  });

  it('Should list correctly an asset: borrow on, collateral on, stable rate on', async () => {
    await waitForTx(gov.execute(proposalOnOnOn));
    const proposalState = await gov.getProposalState(proposalOnOnOn);
    expect(proposalState).to.be.equal(7);
    const { configuration, aTokenAddress } = await pool.getReserveData(TOKEN);
    const poolData = parsePoolData(configuration.data);
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

    // preparing for tests
    const astEth = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(stEth.connect(stEthHolder).approve(pool.address, parseEther('1000')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // stETH deposit by stETH holder
    expect(await astEth.balanceOf(STETH_HOLDER)).to.be.equal('0');
    await waitForTx(
      pool.connect(stEthHolder).deposit(stEth.address, parseEther('50'), STETH_HOLDER, 0)
    );

    // validate that amount of minted astETH tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the stETH shares mechanic
    assertOneWeiLessOrEqual(await astEth.balanceOf(STETH_HOLDER), parseEther('50'));

    // validate that the transferred amount of stETH tokens is equal to the amount of minted
    // astETH and all minted tokens belong to STETH_HOLDER
    expect(await stEth.balanceOf(astEth.address))
      .to.be.equal(await astEth.totalSupply())
      .and.to.be.equal(await astEth.balanceOf(STETH_HOLDER));

    // stETH holder able to borrow DAI against stETH
    await waitForTx(
      pool.connect(stEthHolder).borrow(dai.address, parseEther('1'), 2, 0, STETH_HOLDER)
    );

    // proposer not able to borrow stETH variable against AAVE (VariableDebtStETH minting disabled)
    await expect(
      pool.connect(proposer).borrow(stEth.address, parseEther('10'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.STETH_BORROWING_FORBIDDEN);

    // proposer not able to borrow stETH stable against AAVE (StableDebtStETH minting disabled)
    await expect(
      pool.borrow(stEth.address, parseEther('2'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.STETH_BORROWING_FORBIDDEN);

    // stETH holder able to repay DAI with interests
    await waitForTx(dai.connect(stEthHolder).approve(pool.address, MAX_UINT_AMOUNT));
    await waitForTx(pool.connect(stEthHolder).repay(dai.address, MAX_UINT_AMOUNT, 2, STETH_HOLDER));

    // stETH holder able to withdraw stETH with interests
    const stEthHolderStEthBalanceBeforeWithdraw = await stEth.balanceOf(STETH_HOLDER);
    const stEthHolderAstEthBalanceBeforeWithdraw = await astEth.balanceOf(STETH_HOLDER);
    await waitForTx(
      pool.connect(stEthHolder).withdraw(stEth.address, MAX_UINT_AMOUNT, STETH_HOLDER)
    );

    // validate that amount of withdrawn stETH tokens are equal or 1 WEI less than the
    // astETH balance of the STETH_HOLDER before withdrawing. The difference in 1 WEI
    // might happen due to the stETH shares mechanic
    assertOneWeiLessOrEqual(
      await stEth.balanceOf(STETH_HOLDER),
      stEthHolderStEthBalanceBeforeWithdraw.add(stEthHolderAstEthBalanceBeforeWithdraw)
    );

    // validate that on the balance of astETH token stayed the same amount of stETH as astETH
    // total supply and that all this balance belongs to STETH_HOLDER and this balance doesn't
    // exceed 1 WEI. The 1 WEI might stay on balances after transfers due to the stETH
    // shares mechanic
    expect(await astEth.totalSupply())
      .to.be.equal(await astEth.balanceOf(STETH_HOLDER))
      .and.to.be.equal(await stEth.balanceOf(astEth.address))
      .and.to.be.lte('1');
  });
});

function getContractAt<T extends Contract>(
  name: string,
  address: string,
  signer?: SignerWithAddress | JsonRpcSigner
): Promise<T> {
  return ethers.getContractAt(name, address, signer) as Promise<T>;
}

const waitForTx = async (txPromise: Promise<ContractTransaction>) => {
  const tx = await txPromise;
  return tx.wait();
};

const assertOneWeiLessOrEqual = (actual: BigNumber, expected: BigNumber) => {
  const lowerBound = expected.sub(1);
  expect(actual).to.be.lte(expected).and.to.be.gte(lowerBound);
};
