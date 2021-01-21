import rawBRE, { ethers } from 'hardhat';

export const MAX_UINT_AMOUNT =
  '115792089237316195423570985008687907853269984665640564039457584007913129639935';

export const evmSnapshot = async () => ethers.provider.send('evm_snapshot', []);
export const increaseTime = async (secondsToIncrease: number) => {
  await ethers.provider.send('evm_increaseTime', [secondsToIncrease]);
  await ethers.provider.send('evm_mine', []);
};
export const advanceBlock = async (timestamp?: number) =>
  rawBRE.ethers.provider.send('evm_mine', timestamp ? [timestamp] : []);
export const evmRevert = async (id: string) => ethers.provider.send('evm_revert', [id]);
export const latestBlock = async () => ethers.provider.getBlockNumber();

export const advanceBlockTo = async (target: number) => {
  const currentBlock = await latestBlock();
  console.log('latest block: ', currentBlock);
  const start = Date.now();
  let notified;
  if (target < currentBlock)
    throw Error(`Target block #(${target}) is lower than current block #(${currentBlock})`);
  // eslint-disable-next-line no-await-in-loop
  while ((await latestBlock()) < target) {
    if (!notified && Date.now() - start >= 5000) {
      notified = true;
      console.log("advanceBlockTo: Advancing too many blocks is causing this test to be slow.'");
    }
    // eslint-disable-next-line no-await-in-loop
    await advanceBlock();
  }
};
export const impersonateAccountsHardhat = async (accounts: string[]) => {
  // eslint-disable-next-line no-restricted-syntax
  for (const account of accounts) {
    // eslint-disable-next-line no-await-in-loop
    await rawBRE.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [account],
    });
  }
};
