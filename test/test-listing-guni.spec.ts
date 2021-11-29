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
import { AssetListingGUni } from '../types/AssetListingGUni';
import { SelfdestructTransferFactory } from '../types/SelfdestructTransferFactory'
import { IERC20 } from '../types/IERC20';

const AAVE_GOVERNANCE_V2 = "0xEC568fffba86c094cf06b22134B23074DFE2252c"
const AAVE_LENDING_POOL = "0x7937D4799803FbBe595ed57278Bc4cA21f3bFfCB" //'0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9';
const VOTING_DURATION = 19200;

const GUNI1 = "0x50379f632ca68D36E50cfBC8F78fe16bd1499d1e"

const AAVE_WHALE = '0x25f2226b597e8f9514b3f68f00f494cf4f286491';
const AAVE_TOKEN = '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9';

const GUNI_HOLDER = '0x88215a2794ddC031439C72922EC8983bDE831c78';
const AAVE_ORACLE = '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9';

const DAI_TOKEN = '0x6b175474e89094c44da98b954eedeac495271d0f';
const DAI_HOLDER = '0x72aabd13090af25dbb804f84de6280c697ed1150';

const ERRORS = {
  NO_BORROW: '7',
  NO_COLLATERAL_BALANCE: '9',
  NO_STABLE_BORROW: '12',
};

describe('Deploy G-UNI assets with different params', () => {
  let whale: JsonRpcSigner;
  let guniHolder: JsonRpcSigner;
  let daiHolder: JsonRpcSigner;
  let proposer: SignerWithAddress;
  let gov: IAaveGovernanceV2;
  let pool: ILendingPool;
  let oracle: IAaveOracle;
  let aave: IERC20;
  let guni: IERC20;
  let dai: IERC20;
  let aGuni: IERC20;
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
      await selfDestructContract.destroyAndTransfer(GUNI_HOLDER, {
        value: ethers.utils.parseEther('1'),
      })
    ).wait();
    await impersonateAccountsHardhat([AAVE_WHALE, GUNI_HOLDER, DAI_HOLDER]);

    // impersonating holders

    whale = ethers.provider.getSigner(AAVE_WHALE);
    guniHolder = ethers.provider.getSigner(GUNI_HOLDER);
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
    guni = (await ethers.getContractAt('IERC20', GUNI1, guniHolder)) as IERC20;
    oracle = (await ethers.getContractAt('IAaveOracle', AAVE_ORACLE)) as IAaveOracle;
    decimalMultiplier = BigNumber.from('10').pow(BigNumber.from("18"));

    // Give aave to proposer
    await (
      await aave.transfer(
        proposer.address,
        (await aave.balanceOf(AAVE_WHALE)).sub(parseEther('10000'))
      )
    ).wait();

    // giving just a bit of Dai to GUNI holder to pay for interest later
    await (await dai.transfer(GUNI_HOLDER, parseEther('10'))).wait();
    
    // give GUNI to proposer
    const gUniBalance = await guni.balanceOf(GUNI_HOLDER);
    await (
      await guni.transfer(
        proposer.address,
        gUniBalance.div(BigNumber.from("5"))
      )
    ).wait();


    // deploying the payload
    await rawBRE.ethers.provider.send('evm_mine', [0]);

    await rawBRE.deployments.deploy('AssetListingGUni', {
      from: proposer.address,
      gasLimit: 4000000,
      gasPrice: BigNumber.from('75000000000'),
      args: [],
    });


    proposal = await gov.getProposalsCount();

    await rawBRE.run('create:proposal-new-asset:guni');

    const payloadAddress = (
      await rawBRE.deployments.get('AssetListingGUni')
    ).address;
    console.log(payloadAddress)

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

  it('Should list correctly an asset: borrow off, collateral on, stable borrow off', async () => {
    await (await gov.execute(proposal)).wait();
    
    const proposalState = await gov.getProposalState(proposal);
    expect(proposalState).to.be.equal(7);
    const {
      configuration: { data },
      aTokenAddress,
      stableDebtTokenAddress,
      variableDebtTokenAddress,
    } = await pool.getReserveData(GUNI1);
    const poolData = parsePoolData(data);
    expect(poolData).to.be.eql({
      reserveFactor: '1000',
      reserved: '0',
      stableRateEnabled: '0',
      borrowingEnabled: '0',
      reserveFrozen: '0',
      reserveActive: '1',
      decimals: '18',
      liquidityBonus: '11500',
      LiquidityThreshold: '7000',
      LTV: '6000',
    });

    // preparing for tests.
    console.log("prepare for tests...")
    aGuni = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
    stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
    variableDebt = (await ethers.getContractAt(
      'IERC20',
      variableDebtTokenAddress,
      proposer
    )) as IERC20;
    await (await guni.connect(guniHolder).approve(pool.address, parseEther('200000'))).wait();
    await (await aave.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

    // AAVE deposit by proposer
    /*console.log("aave deposit by proposer")
    await (await pool.deposit(aave.address, parseEther('10'), proposer.address, 0)).wait();*/

    // GUNI deposit by guni holder
    console.log("guni deposit by g uni holder")
    const depositedAmount = parseEther('3');
    await (
      await pool.connect(guniHolder).deposit(guni.address, depositedAmount, GUNI_HOLDER, 0)
    ).wait();
    expect(await aGuni.balanceOf(GUNI_HOLDER)).to.gte(depositedAmount.sub(1));
    expect(await aGuni.balanceOf(GUNI_HOLDER)).to.lte(depositedAmount.add(1));

    // G-UNI holder able to borrow DAI against G-UNI
    console.log("guni holder borrows dai")
    await (
      await pool.connect(guniHolder).borrow(dai.address, parseEther('1'), 2, 0, GUNI_HOLDER)
    ).wait();

    // proposer NOT able to borrow G-UNI
    const borrowAmount = parseEther('10').div(decimalMultiplier);
    await expect(
      pool.connect(proposer).borrow(guni.address, borrowAmount, 2, 0, proposer.address)
    ).to.be.reverted;

    await expect(
      pool.borrow(guni.address, borrowAmount, 1, 0, proposer.address)
    ).to.be.reverted;
    increaseTime(40000);
  });

  it("Oracle should return a non zero G-UNI price", async () => {
    expect(await oracle.getAssetPrice(GUNI1)).to.be.gt('0')
  })
});