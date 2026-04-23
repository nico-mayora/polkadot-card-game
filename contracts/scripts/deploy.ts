import hre from "hardhat";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(hre.config.paths.root, "..");

async function main() {
  const RPC_URL      = process.env.RPC_URL      ?? "http://127.0.0.1:8545";
  const DEPLOYER_KEY = process.env.DEPLOYER_KEY ?? "0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133";

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet   = new ethers.Wallet(DEPLOYER_KEY, provider);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Deploying from: ${wallet.address} (balance: ${ethers.formatUnits(balance, 16)} DOT)`);
  if (balance === 0n) throw new Error("Deployer account has no balance — fund it first");

  const feeData  = await provider.getFeeData();
  const overrides = feeData.gasPrice ? { type: 0, gasPrice: feeData.gasPrice } : {};

  const artifact = await hre.artifacts.readArtifact("ChainCards");
  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(overrides);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`ChainCards deployed to: ${address}`);

  const network = hre.network.name;

  const outPath = path.join(ROOT, "web/src/config/deployments.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ address, abi: artifact.abi, network, deployedAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`Updated ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
