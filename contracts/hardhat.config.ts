import { defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],

  solidity: "0.8.28",

  networks: {
    local: {
      type: "http",
      url: "http://127.0.0.1:8545",
      // Hardhat Account #0 — pre-funded on `npx hardhat node`
      accounts: [
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      ],
    },
    ...(process.env.DEPLOYER_KEY ? {
        paseo: {
            url: "https://testnet-passet-hub-eth-rpc.polkadot.io",
                accounts: [process.env.DEPLOYER_KEY],
        },
    } : {}),
  },
});
