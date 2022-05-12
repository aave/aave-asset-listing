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

config({ path: path.resolve(process.cwd(), '.cvx.env') });

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
  TOKEN_HOLDER,
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
  !TOKEN_HOLDER
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
  CVX_BORROWING_FORBIDDEN: 'CONTRACT_NOT_ACTIVE',
};

describe('Test CVX asset listing with different params', () => {
  let whale: JsonRpcSigner;
  let cvxHolder: JsonRpcSigner;
  let daiHolder: JsonRpcSigner;
  let proposer: SignerWithAddress;
  let gov: IAaveGovernanceV2;
  let pool: ILendingPool;
  let aave: IERC20;
  let cvx: IERC20;
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
    await impersonateAccountsHardhat([AAVE_WHALE, TOKEN_HOLDER, DAI_HOLDER]);
    whale = ethers.provider.getSigner(AAVE_WHALE);
    cvxHolder = ethers.provider.getSigner(TOKEN_HOLDER);
    daiHolder = ethers.provider.getSigner(DAI_HOLDER);

    // getting main entry point contracts
    gov = await getContractAt<IAaveGovernanceV2>('IAaveGovernanceV2', AAVE_GOVERNANCE_V2, proposer);
    pool = await getContractAt<ILendingPool>('ILendingPool', AAVE_LENDING_POOL);

    // getting tokens used for tests
    aave = await getContractAt<IERC20>('IERC20', AAVE_TOKEN, whale);
    dai = await getContractAt<IERC20>('IERC20', DAI_TOKEN, daiHolder);
    cvx = await getContractAt<IERC20>('IERC20', TOKEN, cvxHolder);

    // transfer AAVE tokens to proposer to have propositional power
    await waitForTx(
      aave.transfer(
        proposer.address,
        await aave.balanceOf(AAVE_WHALE).then((balance) => balance.sub(parseEther('10000')))
      )
    );

    // giving just a bit of DAI to CVX holder to pay for interest later
    await waitForTx(dai.transfer(TOKEN_HOLDER, parseEther('10')));

    // giving a bit of CVX to proposer to have to deposit
    await waitForTx(cvx.transfer(proposer.address, parseEther('10')));

    // making 4 different proposals
    // borrow off, collateral off, stable borrow off
    process.env = { ...process.env, ENABLE_AS_COLLATERAL: 'false' };
    proposalOffOffOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:cvx');

    // borrow off, collateral on, stable borrow off (actual CVX listing params)
    process.env = { ...process.env, ENABLE_AS_COLLATERAL: 'true' };
    proposalOffOnOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:cvx');

    // borrow on, collateral off stable borrow off
    process.env = { ...process.env, ENABLE_BORROW: 'true', ENABLE_AS_COLLATERAL: 'false' };
    proposalOnOffOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:cvx');

    // borrow on, collateral on, stable borrow off
    process.env = { ...process.env, ENABLE_AS_COLLATERAL: 'true' };
    proposalOnOnOff = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:cvx');

    // borrow on, collateral on, stable borrow on
    process.env = { ...process.env, ENABLE_STABLE_BORROW: 'true' };
    proposalOnOnOn = await gov.getProposalsCount();
    await rawBRE.run('create:proposal-new-asset:cvx');

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
    const acvx = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(cvx.connect(cvxHolder).approve(pool.address, parseEther('100')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // CVX deposit by CVX holder
    await waitForTx(
      pool.connect(cvxHolder).deposit(cvx.address, parseEther('50'), TOKEN_HOLDER, 0)
    );

    // validate that amount of minted aCVX tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the CVX shares mechanic
    assertOneWeiLessOrEqual(await acvx.balanceOf(TOKEN_HOLDER), parseEther('50'));

    // validate that the transferred amount of CVX tokens is equal to the amount of minted
    // aCVX and all minted tokens belong to TOKEN_HOLDER
    expect(await cvx.balanceOf(acvx.address))
      .to.be.equal(await acvx.totalSupply())
      .and.to.be.equal(await acvx.balanceOf(TOKEN_HOLDER));

    // CVX holder not able to borrow DAI against CVX
    await expect(
      pool.connect(cvxHolder).borrow(dai.address, parseEther('1'), 2, 0, TOKEN_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

    // proposer not able to borrow CVX variable against AAVE
    await expect(
      pool.borrow(cvx.address, parseEther('5'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    // proposer not able to borrow CVX stable against AAVE
    await expect(
      pool.borrow(cvx.address, parseEther('2'), 1, 0, proposer.address)
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
    const acvx = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(cvx.connect(cvxHolder).approve(pool.address, parseEther('1000')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // validate that before deposit were no minted aCVX tokens
    expect(await acvx.totalSupply()).to.be.equal('0');
    expect(await acvx.balanceOf(TOKEN_HOLDER)).to.be.equal('0');

    // CVX deposit by CVX holder
    await waitForTx(
      pool.connect(cvxHolder).deposit(cvx.address, parseEther('50'), TOKEN_HOLDER, 0)
    );

    // validate that amount of minted aCVX tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the CVX shares mechanic
    assertOneWeiLessOrEqual(await acvx.balanceOf(TOKEN_HOLDER), parseEther('50'));

    // validate that the transferred amount of CVX tokens is equal to the amount of minted
    // aCVX and all minted tokens belong to TOKEN_HOLDER
    expect(await cvx.balanceOf(acvx.address))
      .to.be.equal(await acvx.totalSupply())
      .and.to.be.equal(await acvx.balanceOf(TOKEN_HOLDER));

    // CVX holder able to borrow DAI against CVX
    await waitForTx(
      pool.connect(cvxHolder).borrow(dai.address, parseEther('1'), 2, 0, TOKEN_HOLDER)
    );

    // proposer not able to borrow CVX variable against AAVE
    await expect(
      pool.borrow(cvx.address, parseEther('5'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    // proposer not able to borrow CVX stable against AAVE
    await expect(
      pool.borrow(cvx.address, parseEther('2'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    // CVX holder able to repay DAI with interests
    await waitForTx(dai.connect(cvxHolder).approve(pool.address, MAX_UINT_AMOUNT));
    await waitForTx(pool.connect(cvxHolder).repay(dai.address, MAX_UINT_AMOUNT, 2, TOKEN_HOLDER));

    // CVX holder able to withdraw CVX
    const cvxHolderCVXBalanceBeforeWithdraw = await cvx.balanceOf(TOKEN_HOLDER);
    const cvxHolderAcvxBalanceBeforeWithdraw = await acvx.balanceOf(TOKEN_HOLDER);
    await waitForTx(
      pool.connect(cvxHolder).withdraw(cvx.address, MAX_UINT_AMOUNT, TOKEN_HOLDER)
    );

    // validate that amount of withdrawn CVX tokens are equal or 1 WEI less than the
    // aCVX balance of the TOKEN_HOLDER before withdrawing. The difference in 1 WEI
    // might happen due to the CVX shares mechanic
    assertOneWeiLessOrEqual(
      await cvx.balanceOf(TOKEN_HOLDER),
      cvxHolderCVXBalanceBeforeWithdraw.add(cvxHolderAcvxBalanceBeforeWithdraw)
    );

    // validate that on the balance of aCVX token stayed the same amount of CVX as aCVX
    // total supply and that all this balance belongs to TOKEN_HOLDER and this balance doesn't
    // exceed 1 WEI. The 1 WEI might stay on balances after transfers due to the CVX
    // shares mechanic
    expect(await acvx.totalSupply())
      .to.be.equal(await acvx.balanceOf(TOKEN_HOLDER))
      .and.to.be.equal(await cvx.balanceOf(acvx.address))
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
    const acvx = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(cvx.connect(cvxHolder).approve(pool.address, parseEther('100')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // CVX deposit by CVX holder
    await waitForTx(
      pool.connect(cvxHolder).deposit(cvx.address, parseEther('50'), TOKEN_HOLDER, 0)
    );

    // validate that amount of minted aCVX tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the CVX shares mechanic
    assertOneWeiLessOrEqual(await acvx.balanceOf(TOKEN_HOLDER), parseEther('50'));

    // validate that the transferred amount of CVX tokens is equal to the amount of minted
    // aCVX and all minted tokens belong to TOKEN_HOLDER
    expect(await cvx.balanceOf(acvx.address))
      .to.be.equal(await acvx.totalSupply())
      .and.to.be.equal(await acvx.balanceOf(TOKEN_HOLDER));

    // CVX holder not able to borrow DAI against CVX
    await expect(
      pool.connect(cvxHolder).borrow(dai.address, parseEther('1'), 2, 0, TOKEN_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

    // proposer not able to borrow CVX variable against AAVE (VariableDebtCVX minting disabled)
    await expect(
      pool.connect(proposer).borrow(cvx.address, parseEther('10'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.CVX_BORROWING_FORBIDDEN);

    // proposer not able to borrow CVX stable against AAVE
    await expect(
      pool.borrow(cvx.address, parseEther('2'), 1, 0, proposer.address)
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
    const acvx = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(cvx.connect(cvxHolder).approve(pool.address, parseEther('1000')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // validate that before deposit were no minted aCVX tokens
    expect(await acvx.totalSupply()).to.be.equal('0');
    expect(await acvx.balanceOf(TOKEN_HOLDER)).to.be.equal('0');

    // CVX deposit by CVX holder
    await waitForTx(
      pool.connect(cvxHolder).deposit(cvx.address, parseEther('0.5'), TOKEN_HOLDER, 0)
    );

    // validate that amount of minted aCVX tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the CVX shares mechanic
    assertOneWeiLessOrEqual(await acvx.balanceOf(TOKEN_HOLDER), parseEther('0.5'));

    // validate that the transferred amount of CVX tokens is equal to the amount of minted
    // aCVX and all minted tokens belong to TOKEN_HOLDER
    expect(await cvx.balanceOf(acvx.address))
      .to.be.equal(await acvx.totalSupply())
      .and.to.be.equal(await acvx.balanceOf(TOKEN_HOLDER));

    // CVX holder able to borrow DAI against CVX
    await waitForTx(
      pool.connect(cvxHolder).borrow(dai.address, parseEther('1'), 2, 0, TOKEN_HOLDER)
    );

    // proposer not able to borrow CVX variable against AAVE (VariableDebtCVX minting disabled)
    await expect(
      pool.connect(proposer).borrow(cvx.address, parseEther('10'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.CVX_BORROWING_FORBIDDEN);

    // proposer not able to borrow CVX stable against AAVE
    await expect(
      pool.borrow(cvx.address, parseEther('2'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_STABLE_BORROW);

    // CVX holder able to repay DAI with interests
    await waitForTx(dai.connect(cvxHolder).approve(pool.address, MAX_UINT_AMOUNT));
    await waitForTx(pool.connect(cvxHolder).repay(dai.address, MAX_UINT_AMOUNT, 2, TOKEN_HOLDER));

    // CVX holder able to withdraw CVX
    const cvxHolderCVXBalanceBeforeWithdraw = await cvx.balanceOf(TOKEN_HOLDER);
    const cvxHolderAcvxBalanceBeforeWithdraw = await acvx.balanceOf(TOKEN_HOLDER);
    await waitForTx(
      pool.connect(cvxHolder).withdraw(cvx.address, MAX_UINT_AMOUNT, TOKEN_HOLDER)
    );

    // validate that amount of withdrawn CVX tokens are equal or 1 WEI less than the
    // aCVX balance of the TOKEN_HOLDER before withdrawing. The difference in 1 WEI
    // might happen due to the CVX shares mechanic
    assertOneWeiLessOrEqual(
      await cvx.balanceOf(TOKEN_HOLDER),
      cvxHolderCVXBalanceBeforeWithdraw.add(cvxHolderAcvxBalanceBeforeWithdraw)
    );

    // validate that on the balance of aCVX token stayed the same amount of CVX as aCVX
    // total supply and that all this balance belongs to TOKEN_HOLDER and this balance doesn't
    // exceed 1 WEI. The 1 WEI might stay on balances after transfers due to the CVX
    // shares mechanic
    expect(await acvx.totalSupply())
      .to.be.equal(await acvx.balanceOf(TOKEN_HOLDER))
      .and.to.be.equal(await cvx.balanceOf(acvx.address))
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
    const acvx = await getContractAt<IERC20>('IERC20', aTokenAddress, proposer);
    await waitForTx(cvx.connect(cvxHolder).approve(pool.address, parseEther('1000')));
    await waitForTx(aave.connect(proposer).approve(pool.address, parseEther('100000')));

    // AAVE deposit by proposer
    await waitForTx(pool.deposit(aave.address, parseEther('100000'), proposer.address, 0));

    // CVX deposit by CVX holder
    expect(await acvx.balanceOf(TOKEN_HOLDER)).to.be.equal('0');
    await waitForTx(
      pool.connect(cvxHolder).deposit(cvx.address, parseEther('50'), TOKEN_HOLDER, 0)
    );

    // validate that amount of minted aCVX tokens is equal to or 1 WEI less than the amount
    // of deposit. The difference in 1 WEI might happen due to the CVX shares mechanic
    assertOneWeiLessOrEqual(await acvx.balanceOf(TOKEN_HOLDER), parseEther('50'));

    // validate that the transferred amount of CVX tokens is equal to the amount of minted
    // aCVX and all minted tokens belong to TOKEN_HOLDER
    expect(await cvx.balanceOf(acvx.address))
      .to.be.equal(await acvx.totalSupply())
      .and.to.be.equal(await acvx.balanceOf(TOKEN_HOLDER));

    // CVX holder able to borrow DAI against CVX
    await waitForTx(
      pool.connect(cvxHolder).borrow(dai.address, parseEther('1'), 2, 0, TOKEN_HOLDER)
    );

    // proposer not able to borrow CVX variable against AAVE (VariableDebtCVX minting disabled)
    await expect(
      pool.connect(proposer).borrow(cvx.address, parseEther('10'), 2, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.CVX_BORROWING_FORBIDDEN);

    // proposer not able to borrow CVX stable against AAVE (StableDebtCVX minting disabled)
    await expect(
      pool.borrow(cvx.address, parseEther('2'), 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.CVX_BORROWING_FORBIDDEN);

    // CVX holder able to repay DAI with interests
    await waitForTx(dai.connect(cvxHolder).approve(pool.address, MAX_UINT_AMOUNT));
    await waitForTx(pool.connect(cvxHolder).repay(dai.address, MAX_UINT_AMOUNT, 2, TOKEN_HOLDER));

    // CVX holder able to withdraw CVX with interests
    const cvxHolderCVXBalanceBeforeWithdraw = await cvx.balanceOf(TOKEN_HOLDER);
    const cvxHolderAcvxBalanceBeforeWithdraw = await acvx.balanceOf(TOKEN_HOLDER);
    await waitForTx(
      pool.connect(cvxHolder).withdraw(cvx.address, MAX_UINT_AMOUNT, TOKEN_HOLDER)
    );

    // validate that amount of withdrawn CVX tokens are equal or 1 WEI less than the
    // aCVX balance of the TOKEN_HOLDER before withdrawing. The difference in 1 WEI
    // might happen due to the CVX shares mechanic
    assertOneWeiLessOrEqual(
      await cvx.balanceOf(TOKEN_HOLDER),
      cvxHolderCVXBalanceBeforeWithdraw.add(cvxHolderAcvxBalanceBeforeWithdraw)
    );

    // validate that on the balance of aCVX token stayed the same amount of CVX as aCVX
    // total supply and that all this balance belongs to TOKEN_HOLDER and this balance doesn't
    // exceed 1 WEI. The 1 WEI might stay on balances after transfers due to the CVX
    // shares mechanic
    expect(await acvx.totalSupply())
      .to.be.equal(await acvx.balanceOf(TOKEN_HOLDER))
      .and.to.be.equal(await cvx.balanceOf(acvx.address))
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
