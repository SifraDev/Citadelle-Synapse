import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  type PublicClient,
  type WalletClient,
  type Log,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { store } from "./store.js";
import { sendMessage } from "./telegram.js";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const AGENT_WALLET = "0x0128D1EE63C0e99CB3f587E982619bC8B00Ad443" as const;
const USDC_DECIMALS = 6;

const ERC20_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const transport = http("https://mainnet.base.org");

let _publicClient: PublicClient | null = null;
let _walletClient: WalletClient | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastProcessedBlock: bigint = 0n;

function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: base,
      transport,
    }) as PublicClient;
  }
  return _publicClient;
}

function getWalletClient(): WalletClient | null {
  if (_walletClient) return _walletClient;
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    console.log("[Crypto] PRIVATE_KEY not set, wallet client unavailable");
    return null;
  }
  try {
    const account = privateKeyToAccount(pk.startsWith("0x") ? pk as `0x${string}` : `0x${pk}`);
    _walletClient = createWalletClient({
      account,
      chain: base,
      transport,
    });
    console.log(`[Crypto] Wallet client initialized for ${account.address}`);
    return _walletClient;
  } catch (err) {
    console.error("[Crypto] Failed to initialize wallet client:", err);
    return null;
  }
}

export function getAgentWallet(): string {
  return AGENT_WALLET;
}

export function getUsdcAddress(): string {
  return USDC_ADDRESS;
}

export function isWalletReady(): boolean {
  return getWalletClient() !== null;
}

export async function getEthBalance(): Promise<string> {
  try {
    const client = getPublicClient();
    const balance = await client.getBalance({ address: AGENT_WALLET });
    return formatUnits(balance, 18);
  } catch (err) {
    console.error("[Crypto] Failed to read ETH balance:", err);
    return "0";
  }
}

export async function getUsdcBalance(): Promise<string> {
  try {
    const client = getPublicClient();
    const balance = await client.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [AGENT_WALLET],
    });
    return formatUnits(balance as bigint, USDC_DECIMALS);
  } catch (err) {
    console.error("[Crypto] Failed to read USDC balance:", err);
    return "0";
  }
}

async function processTransferLogs(logs: Log[]) {
  for (const log of logs) {
    const from = ("0x" + (log.topics[1] || "").slice(26)) as string;
    const to = ("0x" + (log.topics[2] || "").slice(26)) as string;

    if (to.toLowerCase() !== AGENT_WALLET.toLowerCase()) continue;

    const value = log.data ? BigInt(log.data) : 0n;
    const amount = formatUnits(value, USDC_DECIMALS);
    const txHash = log.transactionHash || undefined;

    const existingPayments = store.getPayments(500);
    if (txHash && existingPayments.some((p) => p.txHash === txHash)) continue;

    const charges = store.listCharges();
    const matchedCharge = charges.find(
      (c) =>
        c.status === "pending" &&
        Math.abs(parseFloat(c.amount) - parseFloat(amount)) < 0.01
    );

    if (matchedCharge) {
      store.updateCharge(matchedCharge.id, {
        status: "paid",
        txHash: txHash,
        paidAt: new Date().toISOString(),
        paidFrom: from,
      });
    }

    store.addPayment({
      txHash,
      from,
      to,
      amount,
      token: "USDC",
      status: "confirmed",
      timestamp: new Date().toISOString(),
      network: "Base",
    });

    await sendMessage(
      `💰 <b>USDC Payment Received</b>\n\nAmount: ${amount} USDC\nFrom: <code>${from}</code>\nTx: <a href="https://basescan.org/tx/${txHash}">${txHash?.slice(0, 16)}...</a>\nNetwork: Base`
    );

    store.addActivity("payment", `Received ${amount} USDC on Base from ${from.slice(0, 10)}...`, {
      txHash,
      from,
      amount,
      network: "Base",
    });
  }
}

export async function startTransferMonitor(): Promise<void> {
  if (pollInterval) return;

  getWalletClient();

  try {
    const client = getPublicClient();
    const currentBlock = await client.getBlockNumber();
    lastProcessedBlock = currentBlock - 100n;

    console.log(`[Crypto] Starting USDC transfer monitor from block ${lastProcessedBlock}`);
    store.addActivity("system", `USDC transfer monitor started on Base (block ${lastProcessedBlock})`);

    pollInterval = setInterval(async () => {
      try {
        const client = getPublicClient();
        const latestBlock = await client.getBlockNumber();

        if (latestBlock <= lastProcessedBlock) return;

        const fromBlock = lastProcessedBlock + 1n;
        const toBlock = latestBlock;

        const logs = await client.getLogs({
          address: USDC_ADDRESS,
          event: {
            type: "event",
            name: "Transfer",
            inputs: [
              { name: "from", type: "address", indexed: true },
              { name: "to", type: "address", indexed: true },
              { name: "value", type: "uint256", indexed: false },
            ],
          },
          args: {
            to: AGENT_WALLET,
          },
          fromBlock,
          toBlock,
        });

        if (logs.length > 0) {
          await processTransferLogs(logs as Log[]);
        }

        lastProcessedBlock = toBlock;
      } catch (err) {
        console.error("[Crypto] Poll error:", err);
      }
    }, 15000);
  } catch (err) {
    console.error("[Crypto] Failed to start monitor:", err);
  }
}

export async function verifyTransaction(txHash: string, recipientAddress?: string): Promise<{
  verified: boolean;
  from?: string;
  to?: string;
  amount?: string;
  error?: string;
}> {
  try {
    const client = getPublicClient();
    const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (receipt.status !== "success") {
      return { verified: false, error: "Transaction reverted" };
    }

    const targetWallet = (recipientAddress || AGENT_WALLET).toLowerCase();
    const transferLog = receipt.logs.find(
      (log) =>
        log.address.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
        log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" &&
        log.topics[2] &&
        ("0x" + log.topics[2].slice(26)).toLowerCase() === targetWallet
    );

    if (!transferLog) {
      return { verified: false, error: `No USDC transfer to ${recipientAddress ? "Locus" : "agent"} wallet found in transaction` };
    }

    const from = "0x" + (transferLog.topics[1] || "").slice(26);
    const value = transferLog.data ? BigInt(transferLog.data) : 0n;
    const amount = formatUnits(value, USDC_DECIMALS);

    const to = "0x" + (transferLog.topics[2] || "").slice(26);
    return { verified: true, from, to, amount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { verified: false, error: `Verification failed: ${msg}` };
  }
}

export function stopTransferMonitor(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}
