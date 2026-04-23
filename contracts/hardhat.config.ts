import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],

  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true },
  },

  networks: {
    local: {
      type: "http",
      url: "http://127.0.0.1:8545",
      // Alice dev account — pre-funded on Polkadot local EVM chains
      accounts: [
        "0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133",
      ],
    },
    ...(process.env.DEPLOYER_KEY ? {
        paseo: {
            type: "http" as const,
            url: "https://services.polkadothub-rpc.com/testnet",
            accounts: [process.env.DEPLOYER_KEY],
        },
    } : {}),
  },
});
