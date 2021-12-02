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
import { SelfdestructTransferFactory } from '../types/SelfdestructTransferFactory'
import { IERC20 } from '../types/IERC20';

config({ path: path.resolve(process.cwd(), '.guni.env') });

const {
  TOKEN0,
  TOKEN1
} = process.env;

if (!TOKEN0 || !TOKEN1) {
  throw new Error('You have not set correctly the .env file');
}

const AAVE_GOVERNANCE_V2 = "0xEC568fffba86c094cf06b22134B23074DFE2252c"
const AAVE_LENDING_POOL = "0x7937D4799803FbBe595ed57278Bc4cA21f3bFfCB"
const VOTING_DURATION = 19200;

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
  let guni0: IERC20;
  let guni1: IERC20;
  let dai: IERC20;
  let aGuni: IERC20;
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
    guni0 = (await ethers.getContractAt('IERC20', TOKEN0, guniHolder)) as IERC20;
    guni1 = (await ethers.getContractAt('IERC20', TOKEN1, guniHolder)) as IERC20;
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
    let gUniBalance = await guni0.balanceOf(GUNI_HOLDER);
    await (
      await guni0.transfer(
        proposer.address,
        gUniBalance.div(BigNumber.from("5"))
      )
    ).wait();

    gUniBalance = await guni1.balanceOf(GUNI_HOLDER);
    await (
      await guni1.transfer(
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

    const expectedConfig = {
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
    };

    let reserveData = await pool.getReserveData(TOKEN0);
    let poolData = parsePoolData(reserveData.configuration.data);
    expect(poolData).to.be.eql(expectedConfig);

    // preparing for tests on G-UNI DAI/USDC (guni0)
    aGuni = (await ethers.getContractAt('IERC20', reserveData.aTokenAddress, proposer)) as IERC20;
    await (await guni0.connect(guniHolder).approve(pool.address, parseEther('200000'))).wait();

    // GUNI deposit by guni holder
    const depositedAmount0 = parseEther('3');
    await (
      await pool.connect(guniHolder).deposit(guni0.address, depositedAmount0, GUNI_HOLDER, 0)
    ).wait();
    expect(await aGuni.balanceOf(GUNI_HOLDER)).to.eq(depositedAmount0);

    // G-UNI holder able to borrow DAI against G-UNI
    await (
      await pool.connect(guniHolder).borrow(dai.address, parseEther('1'), 2, 0, GUNI_HOLDER)
    ).wait();

    reserveData = await pool.getReserveData(TOKEN1);
    poolData = parsePoolData(reserveData.configuration.data);
    expect(poolData).to.be.eql(expectedConfig);

    // preparing for tests on G-UNI DAI/USDC
    aGuni = (await ethers.getContractAt('IERC20', reserveData.aTokenAddress, proposer)) as IERC20;
    await (await guni1.connect(guniHolder).approve(pool.address, parseEther('200000'))).wait();

    // GUNI deposit by guni holder
    const depositedAmount1 = parseEther('.0000009');
    await (
      await pool.connect(guniHolder).deposit(guni1.address, depositedAmount1, GUNI_HOLDER, 0)
    ).wait();
    expect(await aGuni.balanceOf(GUNI_HOLDER)).to.eq(depositedAmount1);

    // G-UNI holder able to borrow DAI against G-UNI
    await (
      await pool.connect(guniHolder).borrow(dai.address, parseEther('1'), 2, 0, GUNI_HOLDER)
    ).wait();

    // G-UNI holder NOT able to borrow G-UNI
    const borrowAmount0 = parseEther('0.1')
    await expect(
      pool.connect(guniHolder).borrow(guni0.address, borrowAmount0, 2, 0, GUNI_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    await expect(
      pool.borrow(guni0.address, borrowAmount0, 1, 0, GUNI_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    const borrowAmount1 = parseEther('0.0000001')
    await expect(
      pool.connect(proposer).borrow(guni1.address, borrowAmount1, 2, 0, GUNI_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_BORROW);

    await expect(
      pool.borrow(guni1.address, borrowAmount1, 1, 0, GUNI_HOLDER)
    ).to.be.revertedWith(ERRORS.NO_BORROW);
  });

  it("Oracles should return a non zero G-UNI price", async () => {
    expect(await oracle.getAssetPrice(TOKEN0)).to.be.gt('0');
    expect(await oracle.getAssetPrice(TOKEN1)).to.be.gt('0');
  })
});