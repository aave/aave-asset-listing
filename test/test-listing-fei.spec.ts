
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
import { IAaveIncentivesController } from '../types/IAaveIncentivesController';
import { IAaveOracle } from '../types/IAaveOracle';
import { ILendingPool } from '../types/ILendingPool';
import { SelfdestructTransferFactory } from '../types/SelfdestructTransferFactory'
import { IERC20 } from '../types/IERC20';

config({ path: path.resolve(process.cwd(), '.fei.env') });

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

const FEI_HOLDER = '0x9928e4046d7c6513326ccea028cd3e7a91c7590a';
const AAVE_ORACLE = '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9';

const DAI_TOKEN = '0x6b175474e89094c44da98b954eedeac495271d0f';
const DAI_HOLDER = '0x72aabd13090af25dbb804f84de6280c697ed1150';

const INCENTIVES_CONTROLLER = '0xDee5c1662bBfF8f80f7c572D8091BF251b3B0dAB';
const FEI_DAO = '0x639572471f2f318464dc01066a56867130e45E25';
const TRIBE_TOKEN = '0xc7283b66Eb1EB5FB86327f08e1B5816b0720212B';
const TRIBE_TREASURY = '0x8d5ED43dCa8C2F7dFB20CF7b53CC7E593635d7b9';

const ERRORS = {
  NO_BORROW: '7',
  NO_COLLATERAL_BALANCE: '9',
  NO_STABLE_BORROW: '12',
};

describe('Deploy FEI assets with different params', () => {
  let whale: JsonRpcSigner;
  let feiHolder: JsonRpcSigner;
  let tribeHolder: JsonRpcSigner;
  let feiDao: JsonRpcSigner;
  let daiHolder: JsonRpcSigner;
  let proposer: SignerWithAddress;
  let gov: IAaveGovernanceV2;
  let incentivesController: IAaveIncentivesController;
  let pool: ILendingPool;
  let oracle: IAaveOracle;
  let aave: IERC20;
  let fei: IERC20;
  let dai: IERC20;
  let tribe: IERC20;
  let aFei: IERC20;
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
      await selfDestructContract.destroyAndTransfer(FEI_HOLDER, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();

    selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
    await (
      await selfDestructContract.destroyAndTransfer(FEI_DAO, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();

    selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
    await (
      await selfDestructContract.destroyAndTransfer(TRIBE_TREASURY, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();
    await impersonateAccountsHardhat([AAVE_WHALE, FEI_HOLDER, DAI_HOLDER, FEI_DAO, TRIBE_TREASURY]);

    // impersonating holders

    whale = ethers.provider.getSigner(AAVE_WHALE);
    feiHolder = ethers.provider.getSigner(FEI_HOLDER);
    daiHolder = ethers.provider.getSigner(DAI_HOLDER);
    tribeHolder = ethers.provider.getSigner(TRIBE_TREASURY);
    feiDao = ethers.provider.getSigner(FEI_DAO);

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

    incentivesController = (await ethers.getContractAt(
      'IAaveIncentivesController',
      INCENTIVES_CONTROLLER,
      feiDao
    )) as IAaveIncentivesController;

    // getting tokens used for tests
    aave = (await ethers.getContractAt('IERC20', AAVE_TOKEN, whale)) as IERC20;
    dai = (await ethers.getContractAt('IERC20', DAI_TOKEN, daiHolder)) as IERC20;
    fei = (await ethers.getContractAt('IERC20', TOKEN, feiHolder)) as IERC20;
    tribe = (await ethers.getContractAt('IERC20', TRIBE_TOKEN, feiHolder)) as IERC20;
    oracle = (await ethers.getContractAt('IAaveOracle', AAVE_ORACLE)) as IAaveOracle
    decimalMultiplier = BigNumber.from('10').pow(BigNumber.from('18'));
    
    // Give fei to whale
    await (
      await aave.transfer(
        proposer.address,
        (await aave.balanceOf(AAVE_WHALE)).sub(parseEther('10000'))
      )
    ).wait();

    // giving just a bit of Dai to FEI holder to pay for interest later
    await (await dai.transfer(FEI_HOLDER, parseEther('10'))).wait();
    await (
      await fei.transfer(
        proposer.address,
        (await fei.balanceOf(FEI_HOLDER)).sub((parseEther('1000').div(decimalMultiplier)))
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
    
    await rawBRE.run('create:proposal-new-asset:fei');

    // voting, queuing proposals
    await rawBRE.ethers.provider.send('evm_mine', [0]);

    await (await gov.submitVote(proposal, true)).wait();
    await advanceBlockTo((await latestBlock()) + VOTING_DURATION + 1);
    await (await gov.queue(proposal)).wait();
    let proposalState = await gov.getProposalState(proposal);
    expect(proposalState).to.be.equal(5);
    await increaseTime(86400 + 10);
    snapshotId = await evmSnapshot();
  });
  
  it('Should list correctly an asset: borrow on, collateral off, stable borrow off', async () => {

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
      liquidityBonus: '0',
      LiquidityThreshold: '0',
      LTV: '0',
    });

    // preparing for tests.
    aFei = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    await (await fei.connect(feiHolder).approve(pool.address, parseEther('200000'))).wait();
    await (await aave.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

    // AAVE deposit by proposer
    await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();
    // FEI deposit by ampl holder
    const depositedAmount = parseEther('100').div(decimalMultiplier);
    await (
      await pool.connect(feiHolder).deposit(fei.address, depositedAmount, FEI_HOLDER, 0)
    ).wait();
    expect(await aFei.balanceOf(FEI_HOLDER)).to.gte(depositedAmount.sub(1));
    expect(await aFei.balanceOf(FEI_HOLDER)).to.lte(depositedAmount.add(1));

    // FEI holder not able to borrow DAI against FEI
    await expect(
      pool.connect(feiHolder).borrow(dai.address, parseEther('1'), 2, 0, FEI_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

    // proposer able to borrow FEI variable against AAVE
    const borrowAmount = parseEther('10').div(decimalMultiplier);
    await (
      await pool.connect(proposer).borrow(fei.address, borrowAmount, 2, 0, proposer.address)
    ).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(borrowAmount);

    // proposer not able to borrow FEI stable against AAVE
    await expect(
      pool.borrow(fei.address, borrowAmount, 1, 0, proposer.address)
    ).to.be.revertedWith(ERRORS.NO_STABLE_BORROW);
    increaseTime(40000);

    // proposer able to repay FEI variable
    await (await fei.connect(proposer).approve(pool.address, parseEther('100000'))).wait();
    await (await pool.repay(fei.address, MAX_UINT_AMOUNT, 2, proposer.address)).wait();
    expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('0'));
  });

  it("Incentives active on borrowing", async () => {
    const { variableDebtTokenAddress } = await pool.getReserveData(TOKEN);

    // The admin + emissions manager can't be the same address due to proxy restrictions 
    // so we change it
    await (await incentivesController.connect(feiDao).changeAdmin(FEI_HOLDER)).wait();
    
    await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();

    await (
      await incentivesController
        .connect(feiDao)
        .configureAssets([variableDebtTokenAddress], [parseEther('.00001')])
    ).wait();

     // set distribution to end in distant future
    await (await incentivesController.connect(feiDao).setDistributionEnd(parseEther('1'))).wait();

    // Transfer TRIBE to incentivesController
    await (
      await tribe.connect(tribeHolder).transfer(incentivesController.address, parseEther('1000000'))
    ).wait();

    // proposer borrows FEI variable against AAVE
    const borrowAmount = parseEther('10').div(decimalMultiplier);
    await (
      await pool.connect(proposer).borrow(fei.address, borrowAmount, 2, 0, proposer.address)
    ).wait();

    await (
      await incentivesController
        .connect(proposer)
        .claimRewards([variableDebtTokenAddress], parseEther('.00001'), proposer.address)
    ).wait();

    expect(await tribe.balanceOf(proposer.address)).to.be.equal(parseEther('.00001'));
  });

  it("Oracle should return a non zero FEI price", async () => {
    expect(await oracle.getAssetPrice(TOKEN)).to.be.gt('0')
  })
});