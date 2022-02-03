import { HardhatUserConfig } from 'hardhat/config';

import 'hardhat-typechain';
import 'solidity-coverage';
import 'temp-hardhat-etherscan';
import 'hardhat-gas-reporter';
import '@tenderly/hardhat-tenderly';
import 'hardhat-deploy';
import '@nomiclabs/hardhat-waffle';

if (process.env.SKIP_LOAD !== 'true') {
  // eslint-disable-next-line global-require
  require('./tasks/list-new-asset.ts');
  require('./tasks/list-rai.ts');
  require('./tasks/list-bond.ts');
  require('./tasks/list-steth.ts');
}

export const BUIDLEREVM_CHAIN_ID = 31337;
const balance = '1000000000000000000000000';

const accounts = [
  {
    secretKey: '0xc5e8f61d1ab959b397eecc0a37a6517b8e67a0e7cf1f4bce5591f3ed80199122',
    balance,
  },
  {
    secretKey: '0xd49743deccbccc5dc7baa8e69e5be03298da8688a15dd202e20f15d5e0e9a9fb',
    balance,
  },
  {
    secretKey: '0x23c601ae397441f3ef6f1075dcb0031ff17fb079837beadaf3c84d96c6f3e569',
    balance,
  },
  {
    secretKey: '0xee9d129c1997549ee09c0757af5939b2483d80ad649a0eda68e8b0357ad11131',
    balance,
  },
  {
    secretKey: '0x87630b2d1de0fbd5044eb6891b3d9d98c34c8d310c852f98550ba774480e47cc',
    balance,
  },
  {
    secretKey: '0x275cc4a2bfd4f612625204a20a2280ab53a6da2d14860c47a9f5affe58ad86d4',
    balance,
  },
  {
    secretKey: '0xaee25d55ce586148a853ca83fdfacaf7bc42d5762c6e7187e6f8e822d8e6a650',
    balance,
  },
  {
    secretKey: '0xa2e0097c961c67ec197b6865d7ecea6caffc68ebeb00e6050368c8f67fc9c588',
    balance,
  },
];

const DEFAULT_BLOCK_GAS_LIMIT = 12500000;
const DEFAULT_GAS_PRICE = Number(process.env.DEFAULT_GAS_PRICE) || 50000000000; // 50 gwei
const HARDFORK = 'istanbul';
const INFURA_KEY = process.env.INFURA_KEY || '';
const ETHERSCAN_KEY = process.env.ETHERSCAN_KEY || '';
const MNEMONIC_PATH = "m/44'/60'/0'/0";
const MNEMONIC = process.env.MNEMONIC || '';
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || '';
const MAINNET_FORK = process.env.MAINNET_FORK === 'true';

const mainnetFork =
  MAINNET_FORK && process.env.FORKING_BLOCK
    ? {
        // eslint-disable-next-line radix
        blockNumber: parseInt(process.env.FORKING_BLOCK),
        url: ALCHEMY_KEY
          ? `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_KEY}`
          : `https://main.infura.io/v3/${INFURA_KEY}`,
      }
    : undefined;

const getCommonNetworkConfig = (networkName: string, networkId: number) => ({
  url: ALCHEMY_KEY
    ? `https://eth-${
        networkName === 'main' ? 'mainnet' : networkName
      }.alchemyapi.io/v2/${ALCHEMY_KEY}`
    : `https://${networkName}.infura.io/v3/${INFURA_KEY}`,
  hardfork: HARDFORK,
  blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
  gasPrice: DEFAULT_GAS_PRICE,
  chainId: networkId,
  accounts: {
    mnemonic: MNEMONIC,
    path: MNEMONIC_PATH,
    initialIndex: 0,
    count: 20,
  },
});

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: '0.6.12',
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'istanbul',
        },
      },
      {
        version: '0.7.5',
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: 'istanbul',
        },
      },
    ],
  },
  typechain: {
    outDir: 'types',
  },
  etherscan: {
    apiKey: ETHERSCAN_KEY,
  },
  defaultNetwork: 'hardhat',
  mocha: {
    timeout: 0,
  },
  networks: {
    kovan: getCommonNetworkConfig('kovan', 42),
    ropsten: getCommonNetworkConfig('ropsten', 3),
    main: getCommonNetworkConfig('main', 1),
    hardhat: {
      hardfork: 'istanbul',
      blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
      gas: DEFAULT_BLOCK_GAS_LIMIT,
      gasPrice: DEFAULT_GAS_PRICE,
      chainId: BUIDLEREVM_CHAIN_ID,
      throwOnTransactionFailures: true,
      throwOnCallFailures: true,
      // eslint-disable-next-line no-shadow
      accounts: accounts.map(({ secretKey, balance }: { secretKey: string; balance: string }) => ({
        privateKey: secretKey,
        balance,
      })),
      forking: mainnetFork,
    },
    ganache: {
      url: 'http://ganache:8545',
      accounts: {
        mnemonic: 'fox sight canyon orphan hotel grow hedgehog build bless august weather swarm',
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20,
      },
    },
    coverage: {
      url: 'http://localhost:8555',
    },
  },
};

export default config;
