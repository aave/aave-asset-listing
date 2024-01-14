
 import path from 'path';
 import { expect } from 'chai';
 import { config } from 'dotenv';

 import rawBRE, { ethers } from 'hardhat';

 import { BigNumber } from 'ethers';
 import { parseUnits, parseEther } from 'ethers/lib/utils';
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
 import { IAavePullRewardsIncentivesController } from '../types/IAavePullRewardsIncentivesController';
 import { IAaveOracle } from '../types/IAaveOracle';
 import { ILendingPool } from '../types/ILendingPool';
 import { SelfdestructTransferFactory } from '../types/SelfdestructTransferFactory'
 import { IERC20 } from '../types/IERC20';

 config({ path: path.resolve(process.cwd(), '.ust.env') });

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

 const UST_HOLDER = '0x7a5ae802895d5f90b6edbafc870fd348fba2a3d2';
 const AAVE_ORACLE = '0xA50ba011c48153De246E5192C8f9258A2ba79Ca9';

 const DAI_TOKEN = '0x6b175474e89094c44da98b954eedeac495271d0f';
 const DAI_HOLDER = '0x72aabd13090af25dbb804f84de6280c697ed1150';

 const INCENTIVES_CONTROLLER = '0x036cA61C1977c6EA52222Db81F725fDBd70eFBd7';
 const EMISSION_MANAGER = '0xf1a39ccaa7b3e0a6f82c0806518925b54024f011';
 const LUNA_TOKEN = '0xbd31ea8212119f94a611fa969881cba3ea06fa3d';
 const LUNA_TREASURY = '0xe76820F1DB773B1d62a3D22F47259705cC5fA4E6';

 const ERRORS = {
   NO_BORROW: '7',
   NO_COLLATERAL_BALANCE: '9',
   NO_STABLE_BORROW: '12',
 };


export function parseTerra(terra: string): BigNumber {
    return parseUnits(terra, DECIMALS);
}

 describe('Deploy UST assets with different params', () => {
   let whale: JsonRpcSigner;
   let ustHolder: JsonRpcSigner;
   let lunaHolder: JsonRpcSigner;
   let emissionManager: JsonRpcSigner;
   let daiHolder: JsonRpcSigner;
   let proposer: SignerWithAddress;
   let gov: IAaveGovernanceV2;
   let incentivesController: IAavePullRewardsIncentivesController;
   let pool: ILendingPool;
   let oracle: IAaveOracle;
   let aave: IERC20;
   let ust: IERC20;
   let dai: IERC20;
   let luna: IERC20;
   let aUst: IERC20;
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
         value: parseEther('1'),
       })
     ).wait();
     selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
     await (
       await selfDestructContract.destroyAndTransfer(UST_HOLDER, {
         value: parseEther('1'),
       })
     ).wait();

     selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
     await (
       await selfDestructContract.destroyAndTransfer(EMISSION_MANAGER, {
         value: parseEther('1'),
       })
     ).wait();

     selfDestructContract = await new SelfdestructTransferFactory(proposer).deploy();
     await (
       await selfDestructContract.destroyAndTransfer(LUNA_TREASURY, {
         value: parseEther('1'),
       })
     ).wait();
     await impersonateAccountsHardhat([AAVE_WHALE, UST_HOLDER, DAI_HOLDER, EMISSION_MANAGER, LUNA_TREASURY]);

     // impersonating holders

     whale = ethers.provider.getSigner(AAVE_WHALE);
     ustHolder = ethers.provider.getSigner(UST_HOLDER);
     daiHolder = ethers.provider.getSigner(DAI_HOLDER);
     lunaHolder = ethers.provider.getSigner(LUNA_TREASURY);
     emissionManager = ethers.provider.getSigner(EMISSION_MANAGER);

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
       'IAavePullRewardsIncentivesController',
       INCENTIVES_CONTROLLER,
       emissionManager
     )) as IAavePullRewardsIncentivesController;

     // getting tokens used for tests
     aave = (await ethers.getContractAt('IERC20', AAVE_TOKEN, whale)) as IERC20;
     dai = (await ethers.getContractAt('IERC20', DAI_TOKEN, daiHolder)) as IERC20;
     ust = (await ethers.getContractAt('IERC20', TOKEN, ustHolder)) as IERC20;
     luna = (await ethers.getContractAt('IERC20', LUNA_TOKEN, ustHolder)) as IERC20;
     oracle = (await ethers.getContractAt('IAaveOracle', AAVE_ORACLE)) as IAaveOracle
     decimalMultiplier = BigNumber.from('10').pow(BigNumber.from(DECIMALS));

     // Transfer aave to proposer from the whale
     await (
       await aave.transfer(
         proposer.address,
         (await aave.balanceOf(AAVE_WHALE)).sub(parseEther('10000'))
       )
     ).wait();

     // giving just a bit of Dai to Ust holder to pay for interest later
     await (await dai.transfer(UST_HOLDER, parseEther('10'))).wait();
     await (
       await ust.transfer(
         proposer.address,
         (await ust.balanceOf(UST_HOLDER)).sub((parseTerra('1000').div(decimalMultiplier)))
       )
     ).wait();

     // give Luna spend allowance to incentive controller from luna holder
     await (await luna.connect(lunaHolder).approve(incentivesController.address, parseTerra('100000000'))).wait();

     // update reward vault of incentive controller to LunaHolder
     await (await incentivesController.connect(emissionManager).setRewardsVault(LUNA_TREASURY)).wait();

     // deploying the payload
     await rawBRE.ethers.provider.send('evm_mine', [0]);

     await rawBRE.deployments.deploy('AssetListingProposalGenericExecutor', {
       from: proposer.address,
       gasLimit: 4000000,
       gasPrice: BigNumber.from('75000000000'),
       args: [],
     });

     proposal = await gov.getProposalsCount();

     await rawBRE.run('create:proposal-new-asset:ust');

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
     aUst = (await ethers.getContractAt('IERC20', aTokenAddress, proposer)) as IERC20;
     stableDebt = (await ethers.getContractAt('IERC20', stableDebtTokenAddress, proposer)) as IERC20;
     variableDebt = (await ethers.getContractAt(
       'IERC20',
       variableDebtTokenAddress,
       proposer
     )) as IERC20;
     await (await ust.connect(ustHolder).approve(pool.address, parseTerra('200000'))).wait();
     await (await aave.connect(proposer).approve(pool.address, parseEther('200000'))).wait();

     // AAVE deposit by proposer
     await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();
     // UST deposit by UST holder
     const depositedAmount = parseTerra('100').div(decimalMultiplier);
     await (
       await pool.connect(ustHolder).deposit(ust.address, depositedAmount, UST_HOLDER, 0)
     ).wait();
     expect(await aUst.balanceOf(UST_HOLDER)).to.gte(depositedAmount.sub(1));
     expect(await aUst.balanceOf(UST_HOLDER)).to.lte(depositedAmount.add(1));

     // UST holder not able to borrow DAI against UST
     await expect(
       pool.connect(ustHolder).borrow(dai.address, parseEther('1'), 2, 0, UST_HOLDER)
     ).to.be.revertedWith(ERRORS.NO_COLLATERAL_BALANCE);

     // proposer able to borrow UST variable against AAVE
     const borrowAmount = parseTerra('10').div(decimalMultiplier);
     await (
       await pool.connect(proposer).borrow(ust.address, borrowAmount, 2, 0, proposer.address)
     ).wait();
     expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(borrowAmount);

     // proposer not able to borrow UST stable against AAVE
     await expect(
       pool.borrow(ust.address, borrowAmount, 1, 0, proposer.address)
     ).to.be.revertedWith(ERRORS.NO_STABLE_BORROW);
     increaseTime(40000);

     // proposer able to repay UST variable
     await (await ust.connect(proposer).approve(pool.address, parseTerra('100000'))).wait();
     await (await pool.repay(ust.address, MAX_UINT_AMOUNT, 2, proposer.address)).wait();
     expect(await variableDebt.balanceOf(proposer.address)).to.be.equal(parseEther('0'));
   });

   it("Incentives active on borrowing", async () => {
     const { variableDebtTokenAddress } = await pool.getReserveData(TOKEN);

     await (await pool.deposit(aave.address, parseEther('100'), proposer.address, 0)).wait();
     await (
       await incentivesController
         .connect(emissionManager)
         .configureAssets([variableDebtTokenAddress], [parseTerra('.000001')])
     ).wait();

      // set distribution to end in distant future
     await (await incentivesController.connect(emissionManager).setDistributionEnd(parseEther('1'))).wait();
     await (await incentivesController.connect(emissionManager).setDistributionEnd(parseEther('1'))).wait();

     // proposer borrows UST variable against AAVE
     const borrowAmount = parseTerra('10').div(decimalMultiplier);
     await (
       await pool.connect(proposer).borrow(ust.address, borrowAmount, 2, 0, proposer.address)
     ).wait();

     await (
       await incentivesController
         .connect(proposer)
         .claimRewards([variableDebtTokenAddress], parseTerra('.000001'), proposer.address)
     ).wait();

     expect(await luna.balanceOf(proposer.address)).to.be.equal(parseTerra('.000001'));
   });

   it("Oracle should return a non zero UST price", async () => {
     expect(await oracle.getAssetPrice(TOKEN)).to.be.gt('0')
   })
 });
