# Aave Governance V2: Listing a new asset

This repository facilitates the last step of the process of listing a new asset to the Aave protocol, that is creating the on-chain proposal to the Aave Governance.

You must have followed all the previous steps from the [guide](https://docs.aave.com/developers/protocol-governance/governance/propose-your-token-as-new-aave-asset)

## Requirements 
Following the [guide](https://docs.aave.com/developers/protocol-governance/governance/propose-your-token-as-new-aave-asset)
- You must have agreed with the Aave Genesis team on risk parameters for your token during an ARC on the governance forum.
- You must have deployed the AToken, VariableDebtToken, StableDebtToken, InterestStrategy overlying contracts for your token.
- You must have created the associated AIP ([here](https://github.com/aave/aip))
- You must have enough Proposition Power.

## Set the environment variables.

Copy the `.default.env` file, rename it to `.env` and update it to match with your tokens addresses and your risk parameters.

Example for the Curve Token listing: 

```
INFURA_KEY= XXX
MNEMONIC= XXX
TOKEN=0xd533a949740bb3306d119cc777fa900ba034cd52
ATOKEN=0x84ddcafdece3b3e3a93372852b42455a644872a5
STABLE_DEBT_TOKEN=0x288672d311da6edc89765204a6d309701e7289d4
VARIABLE_DEBT_TOKEN=0xcbd8e12555ae7949dc4aea3a33385e25bfc4e0b2
INTEREST_STRATEGY=0xe3a3de71b827cb73663a24cdb6243ba7f986cc3b
LTV=4000
LIQUIDATION_THRESHOLD=5500
LIQUIDATION_BONUS=11500
RESERVE_FACTOR=500
DECIMALS=18
ENABLE_BORROW=false
ENABLE_AS_COLLATERAL=true
ENABLE_AS_RESERVE_COLLATERAL=false
IPFS_HASH=QmNfU4FMdQriJVQeqQTNxgY63iSJVh8yCJf8aFDkQDjaLQ
```

## Run the deployment script

### node: 

`$ npm i`

`$ npm run propose-new-asset:kovan` for kovan

`$ npm run propose-new-asset:main` for mainnet

### docker-compose

In one terminal tab: `docker-compose up`

Enter the container in new tab: `docker-compose exec contracts-env bash`

In the container run: 

`$ npm run propose-new-asset:kovan` for kovan

`$ npm run propose-new-asset:main` for mainnet

## Test
`$ npm run test`

