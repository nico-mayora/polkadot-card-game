import {
  createPublicClient,
  createWalletClient,
  http,
  custom,
  getContract,
  parseUnits,
  parseEventLogs,
} from "viem";
import deployment from "../config/deployments.json";

const IS_PASEO = !!import.meta.env.VITE_ETH_RPC_URL;

const RPC_URL = import.meta.env.VITE_LOCAL_ETH_RPC_URL ||
  import.meta.env.VITE_ETH_RPC_URL ||
  "http://127.0.0.1:8545";

export const publicClient = createPublicClient({
  transport: http(RPC_URL),
});

const LOCAL_CHAIN = {
  id: 31337,
  name: "Card Game Local",
  nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 16 },
  rpcUrls: { default: { http: [RPC_URL] } },
};

// Paseo AssetHub EVM — chain ID 420420421 (0x190F1B5)
const PASEO_CHAIN = {
  id: 420420417,
  name: "Paseo Asset Hub",
  nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 16 },
  rpcUrls: { default: { http: ["https://services.polkadothub-rpc.com/testnet"] } },
};

const ACTIVE_CHAIN = IS_PASEO ? PASEO_CHAIN : LOCAL_CHAIN;

export async function ensureCorrectNetwork() {
  if (!window.ethereum) throw new Error("No wallet found");
  const chainIdHex = await window.ethereum.request({ method: "eth_chainId" });
  if (parseInt(chainIdHex, 16) === ACTIVE_CHAIN.id) return;
  const chainIdParam = `0x${ACTIVE_CHAIN.id.toString(16)}`;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdParam }],
    });
  } catch (e: any) {
    // 4902 = chain not added yet
    if (e.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chainIdParam,
          chainName: ACTIVE_CHAIN.name,
          nativeCurrency: ACTIVE_CHAIN.nativeCurrency,
          rpcUrls: ACTIVE_CHAIN.rpcUrls.default.http,
        }],
      });
    } else throw e;
  }
}

export async function getWalletClient() {
  if (!window.ethereum) throw new Error("No wallet found");
  await ensureCorrectNetwork();
  const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
  return createWalletClient({ account, chain: ACTIVE_CHAIN, transport: custom(window.ethereum) });
}

function gameContract() {
  return getContract({
    address: deployment.address as `0x${string}`,
    abi: deployment.abi,
    client: publicClient,
  });
}

export async function waitForNextBlock(timeout = 120_000) {
  const start = await publicClient.getBlockNumber();
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    if (await publicClient.getBlockNumber() > start) return;
  }
  throw new Error("Timed out waiting for next block");
}

async function sendTx(functionName: string, args?: unknown[], value?: bigint) {
  const wallet = await getWalletClient();
  const hash = await wallet.writeContract({
    address: deployment.address as `0x${string}`,
    abi: deployment.abi,
    functionName,
    args,
    value,
    gas: 500_000n,
  } as any);
  return publicClient.waitForTransactionReceipt({ hash, timeout: 120_000, pollingInterval: 2_000 });
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
  // Scan only the last ~100k blocks (~7 days on Paseo) to avoid querying from genesis
  const latest = await publicClient.getBlockNumber();
  const fromBlock = latest > 100_000n ? latest - 100_000n : 0n;
  const [committed, opened] = await Promise.all([
    publicClient.getLogs({ address: addr, event: { type: "event", name: "PackCommitted", inputs: [{ name: "player", type: "address", indexed: true }] }, args: { player: player as `0x${string}` }, fromBlock }),
    publicClient.getLogs({ address: addr, event: { type: "event", name: "PackOpened", inputs: [{ name: "player", type: "address", indexed: true }, { name: "card0", type: "uint8", indexed: false }, { name: "card1", type: "uint8", indexed: false }, { name: "card2", type: "uint8", indexed: false }, { name: "card3", type: "uint8", indexed: false }, { name: "card4", type: "uint8", indexed: false }] }, args: { player: player as `0x${string}` }, fromBlock }),
  ]);
  return committed.length > opened.length;
}

// ─── Writes ────────────────────────────────────────────────────

export const claimStarterPack = () => sendTx("claimStarterPack");

export const commitPack = () => sendTx("commitPack", [], parseUnits("1", 10));

export const openPack = () => sendTx("openPack");

export const commitDeck = (levelId: number, deck: number[]) =>
  sendTx("commitDeck", [levelId, deck]);

export const commitDeckAndDeal = (levelId: number, deck: number[]) =>
  sendTx("commitDeckAndDeal", [levelId, deck]);

export const dealHand = () => sendTx("dealHand");

export const playCards = (handIndices: number[]) =>
  sendTx("playCards", [handIndices]);

export const playAndDeal = (handIndices: number[]) =>
  sendTx("playAndDeal", [handIndices]);

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
  callback: (player: string, cards: number[]) => void
) {
  return publicClient.watchContractEvent({
    address: deployment.address as `0x${string}`,
    abi: deployment.abi,
    eventName: "PackOpened",
    onLogs: (logs) => {
      for (const log of logs) {
        const { player, card0, card1, card2, card3, card4 } = log.args as any;
        callback(player, [card0, card1, card2, card3, card4].map(Number));
      }
    },
  });
}
