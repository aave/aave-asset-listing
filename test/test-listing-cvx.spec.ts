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

const CVX_HOLDER = '0x0aCA67Fa70B142A3b9bF2eD89A81B40ff85dACdC';
const AAVE_ORACLE = '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9';

const DAI_TOKEN = '0x6b175474e89094c44da98b954eedeac495271d0f';
const DAI_HOLDER = '0x72aabd13090af25dbb804f84de6280c697ed1150';

const ERRORS = {
  NO_BORROW: '7',
  NO_COLLATERAL_BALANCE: '9',
  NO_STABLE_BORROW: '12',
};

describe('Deploy CVX assets with different params', () => {
  let whale: JsonRpcSigner;
  let cvxHolder: JsonRpcSigner;
  let daiHolder: JsonRpcSigner;
  let proposer: SignerWithAddress;
  let gov: IAaveGovernanceV2;
  let pool: ILendingPool;
  let oracle: IAaveOracle;
  let aave: IERC20;
  let cvx: IERC20;
  let dai: IERC20;
  let aCvx: IERC20;
  let stableDebt: IERC20;
  let variableDebt: IERC20;
  let proposal: BigNumber;
  let snapshotId: string;
  let decimalMultiplier: BigNumber;
  before(async () => {
    [proposer] = await rawBRE.ethers.getSigners();
    // send ether to the AAVE_WHALE, which is a non payable contract. Via selfdestruct
    await rawBRE.deployments.deploy('SelfdestructTransfer', { from: proposer.address });
    let selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
    await (
      await selfDestructContract.destroyAndTransfer(AAVE_WHALE, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();
    selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
    await (
      await selfDestructContract.destroyAndTransfer(CVX_HOLDER, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();
    await impersonateAccountsHardhat([AAVE_WHALE, CVX_HOLDER, DAI_HOLDER]);

    // impersonating holders

    whale = ethers.provider.getSigner(AAVE_WHALE);
    cvxHolder = ethers.provider.getSigner(CVX_HOLDER);
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
    cvx = (await ethers.getContractAt('IERC20', TOKEN, cvxHolder)) as IERC20;
    oracle = (await ethers.getContractAt('IAaveOracle', AAVE_ORACLE)) as IAaveOracle;
    decimalMultiplier = BigNumber.from('10').pow(await cvx.decimals());

    // Give cvx to whale
    await (
      await aave.transfer(
        proposer.address,
        (await aave.balanceOf(AAVE_WHALE)).sub(parseEther('10000'))
      )
    ).wait();

    // giving just a bit of Dai to CVX holder to pay for interest later
    await (await dai.transfer(CVX_HOLDER, parseEther('10'))).wait();
    await (
      await cvx.transfer(
        proposer.address,
        (await cvx.balanceOf(CVX_HOLDER)).sub(parseEther('1000').div(decimalMultiplier))
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

    proposal = await gov.getProposalsCount();

    await rawBRE.run('create:proposal-new-asset:cvx');

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

  it('Should list correctly an asset: borrow on, collateral on, stable borrow off', async () => {
    await (await gov.execute(proposal)).wait();
    const proposalState = await gov.getProposalState(proposal);
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
    aCvx = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    await (await cvx.connect(cvxHolder).approve(pool.address, parseEther('200000'))).wait();
    await (await aave.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

    // AAVE deposit by proposer
    await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();
    // CVX deposit by ampl holder
    const depositedAmount = parseEther('100').div(decimalMultiplier);
    await (
      await pool.connect(cvxHolder).deposit(cvx.address, depositedAmount, CVX_HOLDER, 0)
    ).wait();
    expect(await aCvx.balanceOf(CVX_HOLDER)).to.gte(depositedAmount.sub(1));
    expect(await aCvx.balanceOf(CVX_HOLDER)).to.lte(depositedAmount.add(1));

    // CVX holder able to borrow DAI against CVX
    await expect(
      pool.connect(cvxHolder).borrow(dai.address, parseEther('1'), 2, 0, CVX_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

    // proposer able to borrow CVX variable against AAVE
    const borrowAmount = parseEther('10').div(decimalMultiplier);
    await (
      await pool.connect(proposer).borrow(cvx.address, borrowAmount, 2, 0, proposer.address)
    ).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(borrowAmount);

    // proposer not able to borrow CVX stable against AAVE
    await expect(pool.borrow(cvx.address, borrowAmount, 1, 0, proposer.address)).to.be.revertedWith(
      ERRORS.NO_STABLE_BORROW
    );
    increaseTime(40000);

    // proposer able to repay CVX variable
    await (await cvx.connect(proposer).approve(pool.address, parseEther('100000'))).wait();
    await (await pool.repay(cvx.address, MAX_UINT_AMOUNT, 2, proposer.address)).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('0'));
  });

  it('Oracle should return a non zero CVX price', async () => {
    expect(await oracle.getAssetPrice(TOKEN)).to.be.gt('0');
  });
});
