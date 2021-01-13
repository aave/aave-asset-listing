import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { BigNumber } from 'ethers';

const GAS_PRICE = BigNumber.from('75000000000')

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const [, , , , deployer, users] = await hre.getUnnamedAccounts();
  const chain = await hre.getChainId();
  console.log('Chain ID: ', chain);
  // const deployerSigner = (await hre.ethers.getSigners())[0];
  const { deploy } = hre.deployments;
  await deploy('AssetListingProposalGenericExecutor', {
    from: deployer,
    gasLimit: 4000000,
    gasPrice: GAS_PRICE,
    args: [],
  });
};
export default func;
