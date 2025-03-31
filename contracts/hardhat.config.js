require("dotenv-safe/config");
require("hardhat-deploy");
require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./src",
  },
  networks: {
    hardhat: {
      live: false,
      saveDeployments: false,
      tags: ["test", "local"],
    },
    arbitrumSepolia: {
      chainId: 421614,
      url: `https://arbitrum-sepolia.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      live: true,
      saveDeployments: true,
      tags: ["dev"],
    },
    arbitrum: {
      chainId: 42161,
      url: `https://arbitrum-mainnet.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY],
      live: true,
      saveDeployments: true,
      tags: ["production"],
    },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
};
