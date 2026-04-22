import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  getContract,
  parseUnits,
  parseEventLogs,
} from "viem";
import { deployment } from "../config/deployments";

const RPC_URL =
  import.meta.env.VITE_LOCAL_ETH_RPC_URL ||
  import.meta.env.VITE_ETH_RPC_URL ||
  "http://127.0.0.1:8545";

export const publicClient = createPublicClient({
  transport: http(RPC_URL),
});

const LOCAL_CHAIN = {
  id: 31337,
  name: "Card Game Local",
  nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 10 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

export async function ensureLocalNetwork() {
  if (!window.ethereum) throw new Error("No wallet found");
  const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainIdHex, 16) === LOCAL_CHAIN.id) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7A69" }], // 31337
    });
  } catch (e: any) {
    // 4902 = chain not added yet
    if (e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x7A69",
          chainName: "Card Game Local",
          nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 10 },
          rpcUrls: ["http://127.0.0.1:8545"],
        }],
      });
    } else throw e;
  }
}

export async function getWalletClient() {
  if (!window.ethereum) throw new Error("No wallet found");
  await ensureLocalNetwork();
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  return createWalletClient({ account, chain: LOCAL_CHAIN, transport: custom(window.ethereum) });
}

function gameContract() {
  return getContract({
    address: deployment.address as `0x${string}`,
    abi: deployment.abi,
    client: publicClient,
  });
}

export async function waitForNextBlock(timeout = 30_000) {
  const start = await publicClient.getBlockNumber();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1_000));
    if (await publicClient.getBlockNumber() > start) return;
  }
  throw new Error("Timed out waiting for next block");
}

async function waitForNonceIncrease(address: `0x${string}`, nonceBefore: bigint, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const nonce = await publicClient.getTransactionCount({ address, blockTag: "latest" });
    if (BigInt(nonce) > nonceBefore) return;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("Timed out waiting for transaction to be included in a block");
}

async function sendTx(functionName: string, args?: unknown[], value?: bigint) {
  const wallet = await getWalletClient();
  const address = wallet.account.address as `0x${string}`;
  const nonceBefore = BigInt(await publicClient.getTransactionCount({ address, blockTag: "latest" }));
  const hash = await wallet.writeContract({
    address: deployment.address as `0x${string}`,
    abi: deployment.abi,
    functionName,
    args,
    value,
    gas: 500_000n,
  } as any);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000, pollingInterval: 1_000 });
  await waitForNonceIncrease(address, nonceBefore);
  return receipt;
}

export function parseReceiptLogs(receipt: any) {
  return parseEventLogs({ abi: deployment.abi as any, logs: receipt.logs });
}

// ─── Reads ─────────────────────────────────────────────────────

export const getCollection = (player: string) =>
  gameContract().read.getCollection([player]) as Promise<readonly bigint[]>;

export const getGame = (player: string) =>
  gameContract().read.getGame([player]) as Promise<readonly unknown[]>;

export const getStarterClaimed = (player: string) =>
  gameContract().read.starterClaimed([player]) as Promise<boolean>;

export const getActiveTrades = (offset: bigint, limit: bigint) =>
  gameContract().read.getActiveTrades([offset, limit]) as Promise<[readonly bigint[], bigint]>;

export const getTradeDetails = (tradeId: bigint) =>
  gameContract().read.trades([tradeId]) as Promise<any>;

export const getWalletBalance = (address: string) =>
  publicClient.getBalance({ address: address as `0x${string}` });

export async function getPackPending(player: string): Promise<boolean> {
  const addr = deployment.address as `0x${string}`;
  const [committed, opened] = await Promise.all([
    publicClient.getLogs({ address: addr, event: { type: "event", name: "PackCommitted", inputs: [{ name: "player", type: "address", indexed: true }] }, args: { player: player as `0x${string}` }, fromBlock: 0n }),
    publicClient.getLogs({ address: addr, event: { type: "event", name: "PackOpened", inputs: [{ name: "player", type: "address", indexed: true }, { name: "card0", type: "uint8", indexed: false }, { name: "card1", type: "uint8", indexed: false }, { name: "card2", type: "uint8", indexed: false }] }, args: { player: player as `0x${string}` }, fromBlock: 0n }),
  ]);
  return committed.length > opened.length;
}

// ─── Writes ────────────────────────────────────────────────────

export const claimStarterPack = () => sendTx("claimStarterPack");

export const commitPack = () => sendTx("commitPack", [], parseUnits("1", 10));

export const openPack = () => sendTx("openPack");

export const commitDeck = (levelId: number, deck: number[]) =>
  sendTx("commitDeck", [levelId, deck]);

export const dealHand = () => sendTx("dealHand");

export const playCards = (handIndices: number[]) =>
  sendTx("playCards", [handIndices]);

export const forfeitGame = () => sendTx("forfeitGame");

export const createTrade = (
  cardId: number,
  wantsCard: boolean,
  wantedCardId: number,
  tokenPrice: bigint
) => sendTx("createTrade", [cardId, wantsCard, wantedCardId, tokenPrice]);

export const acceptTrade = (tradeId: bigint, value?: bigint) =>
  sendTx("acceptTrade", [tradeId], value ?? 0n);

export const cancelTrade = (tradeId: bigint) => sendTx("cancelTrade", [tradeId]);

// ─── Watchers ──────────────────────────────────────────────────

export function watchPackOpened(
  callback: (player: string, c0: number, c1: number, c2: number) => void
) {
  return publicClient.watchContractEvent({
    address: deployment.address as `0x${string}`,
    abi: deployment.abi,
    eventName: "PackOpened",
    onLogs: (logs) => {
      for (const log of logs) {
        const { player, card0, card1, card2 } = log.args as any;
        callback(player, Number(card0), Number(card1), Number(card2));
      }
    },
  });
}
