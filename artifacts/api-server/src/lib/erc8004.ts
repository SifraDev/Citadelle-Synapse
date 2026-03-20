import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { store } from "./store.js";
import { sendMessage } from "./telegram.js";
import { getAgentWallet } from "./crypto.js";

const IDENTITY_REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" as const;
const REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63" as const;

const IDENTITY_ABI = parseAbi([
  "function register(string tokenURI) returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

const REPUTATION_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int256 value, uint8 valueDecimals, bytes32 tag1, bytes32 tag2, string endpoint, string fileURI, bytes32 fileHash)",
  "function getScore(uint256 agentId) view returns (int256)",
  "function getFeedbackCount(uint256 agentId) view returns (uint256)",
]);

const transport = http("https://mainnet.base.org");

export interface AgentIdentity {
  registered: boolean;
  agentId?: number;
  tokenURI?: string;
  registryAddress: string;
  reputationRegistryAddress: string;
  walletAddress: string;
  registrationTxHash?: string;
  reputationScore?: number;
  feedbackCount?: number;
}

export interface AgentLogEntry {
  timestamp: string;
  type: "swap" | "payment" | "delegation" | "registration" | "reputation";
  description: string;
  txHash?: string;
  amount?: string;
  token?: string;
  counterparty?: string;
}

let _agentId: number | null = null;
let _registrationTxHash: string | null = null;
let _lastCheckResult: AgentIdentity | null = null;
const _agentLog: AgentLogEntry[] = [];

function getAccount() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk.startsWith("0x") ? (pk as `0x${string}`) : `0x${pk}`);
  } catch {
    return null;
  }
}

export function getAgentLog(): AgentLogEntry[] {
  return [..._agentLog];
}

export function addAgentLogEntry(entry: Omit<AgentLogEntry, "timestamp">): void {
  _agentLog.push({
    ...entry,
    timestamp: new Date().toISOString(),
  });
  if (_agentLog.length > 500) {
    _agentLog.splice(0, _agentLog.length - 500);
  }
}

function rpcWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), ms)),
  ]);
}

let _checkPromise: Promise<AgentIdentity> | null = null;
let _lastCheckTime = 0;
const CACHE_TTL = 30_000;

async function _doCheckRegistration(): Promise<AgentIdentity> {
  const walletAddress = getAgentWallet();
  const result: AgentIdentity = {
    registered: _agentId !== null,
    agentId: _agentId ?? undefined,
    registryAddress: IDENTITY_REGISTRY,
    reputationRegistryAddress: REPUTATION_REGISTRY,
    walletAddress,
    registrationTxHash: _registrationTxHash ?? undefined,
  };

  try {
    const publicClient = createPublicClient({ chain: base, transport });
    const balance = await rpcWithTimeout(
      publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: IDENTITY_ABI,
        functionName: "balanceOf",
        args: [walletAddress as `0x${string}`],
      }),
      5000
    ) as bigint;

    if (balance > 0n) {
      result.registered = true;
      if (_agentId !== null) {
        result.agentId = _agentId;
      }
    }

    if (_agentId !== null) {
      try {
        const [score, count] = await Promise.all([
          rpcWithTimeout(
            publicClient.readContract({
              address: REPUTATION_REGISTRY,
              abi: REPUTATION_ABI,
              functionName: "getScore",
              args: [BigInt(_agentId)],
            }),
            5000
          ) as Promise<bigint>,
          rpcWithTimeout(
            publicClient.readContract({
              address: REPUTATION_REGISTRY,
              abi: REPUTATION_ABI,
              functionName: "getFeedbackCount",
              args: [BigInt(_agentId)],
            }),
            5000
          ) as Promise<bigint>,
        ]);
        result.reputationScore = Number(score);
        result.feedbackCount = Number(count);
      } catch {
        // reputation query failed, non-blocking
      }
    }

    if (_registrationTxHash) {
      result.registrationTxHash = _registrationTxHash;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    console.error("[ERC-8004] Registration check:", msg);
  }

  _lastCheckResult = result;
  _lastCheckTime = Date.now();
  _checkPromise = null;
  return result;
}

export async function checkRegistration(): Promise<AgentIdentity> {
  if (_lastCheckResult && Date.now() - _lastCheckTime < CACHE_TTL) {
    if (_agentId !== null) {
      _lastCheckResult.agentId = _agentId;
    }
    return _lastCheckResult;
  }

  if (_checkPromise) {
    return _lastCheckResult ?? _checkPromise;
  }

  _checkPromise = _doCheckRegistration();
  return _checkPromise;
}

export async function registerAgent(): Promise<{
  success: boolean;
  agentId?: number;
  txHash?: string;
  error?: string;
}> {
  const account = getAccount();
  if (!account) {
    return { success: false, error: "PRIVATE_KEY not set" };
  }

  const existing = await checkRegistration();
  if (existing.registered) {
    return { success: true, agentId: existing.agentId, error: "Already registered" };
  }

  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || "venice-legal.replit.app";
  const agentJson = buildAgentJson(domain);
  const tokenURI = `https://${domain}/.well-known/agent.json`;

  try {
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport,
    });
    const publicClient = createPublicClient({ chain: base, transport });

    const txHash = await walletClient.writeContract({
      address: IDENTITY_REGISTRY,
      abi: IDENTITY_ABI,
      functionName: "register",
      args: [tokenURI],
    });

    console.log(`[ERC-8004] Registration tx: ${txHash}`);
    _registrationTxHash = txHash;

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return { success: false, error: "Registration transaction reverted" };
    }

    let agentId: number | undefined;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() && log.topics.length >= 4) {
        const tokenIdHex = log.topics[3];
        if (tokenIdHex) {
          _agentId = Number(BigInt(tokenIdHex));
          agentId = _agentId;
          break;
        }
      }
    }

    _lastCheckTime = 0;
    _lastCheckResult = null;

    store.addActivity("system", `ERC-8004 Agent registered on-chain (ID: ${agentId}, tx: ${txHash.slice(0, 16)}...)`);
    addAgentLogEntry({
      type: "registration",
      description: `Agent identity registered on Base mainnet IdentityRegistry`,
      txHash,
    });

    await sendMessage(
      `🆔 <b>ERC-8004 Agent Registered</b>\n\nAgent ID: ${agentId}\nRegistry: <code>${IDENTITY_REGISTRY}</code>\nTx: <a href="https://basescan.org/tx/${txHash}">${txHash.slice(0, 16)}...</a>`
    );

    return { success: true, agentId: agentId ?? undefined, txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[ERC-8004] Registration failed:", msg);
    return { success: false, error: `Registration failed: ${msg}` };
  }
}

export async function submitReputationFeedback(
  value: number,
  tag1: string,
  tag2: string,
  endpoint: string,
  fileURI: string,
  txHashRef?: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const account = getAccount();
  if (!account) {
    return { success: false, error: "PRIVATE_KEY not set" };
  }

  if (_agentId === null) {
    const check = await checkRegistration();
    if (!check.registered || check.agentId === undefined) {
      return { success: false, error: "Agent not registered — register first" };
    }
  }

  try {
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport,
    });
    const publicClient = createPublicClient({ chain: base, transport });

    const tag1Bytes = stringToBytes32(tag1);
    const tag2Bytes = stringToBytes32(tag2);
    const fileHash = stringToBytes32(txHashRef || "");

    const txHash = await walletClient.writeContract({
      address: REPUTATION_REGISTRY,
      abi: REPUTATION_ABI,
      functionName: "giveFeedback",
      args: [
        BigInt(_agentId!),
        BigInt(value),
        2,
        tag1Bytes,
        tag2Bytes,
        endpoint,
        fileURI,
        fileHash,
      ],
    });

    console.log(`[ERC-8004] Reputation feedback tx: ${txHash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return { success: false, error: "Reputation feedback transaction reverted" };
    }

    addAgentLogEntry({
      type: "reputation",
      description: `Reputation feedback submitted: ${tag1}/${tag2} value=${value}`,
      txHash,
    });

    store.addActivity("system", `ERC-8004 reputation feedback submitted (tx: ${txHash.slice(0, 16)}...)`);

    return { success: true, txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[ERC-8004] Reputation feedback failed:", msg);
    return { success: false, error: `Reputation feedback failed: ${msg}` };
  }
}

export async function recordActionReceipt(
  actionType: AgentLogEntry["type"],
  description: string,
  txHash?: string,
  amount?: string,
  token?: string,
  counterparty?: string
): Promise<void> {
  addAgentLogEntry({
    type: actionType,
    description,
    txHash,
    amount,
    token,
    counterparty,
  });

  if (_agentId !== null && txHash) {
    try {
      await submitReputationFeedback(
        100,
        actionType,
        "completed",
        `https://${process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || "localhost"}/agent_log.json`,
        `https://basescan.org/tx/${txHash}`,
        txHash
      );
    } catch (err) {
      console.error("[ERC-8004] Failed to submit reputation receipt:", err);
    }
  }
}

export function buildAgentJson(domain: string) {
  const walletAddress = getAgentWallet();
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Venice AI Legal Analysis Agent",
    description: "Autonomous legal document analysis agent with on-chain payment processing, USDC treasury management, and Uniswap swap delegation on Base mainnet.",
    image: `https://${domain}/logo.png`,
    services: [
      {
        type: "web",
        url: `https://${domain}`,
        description: "Web dashboard for legal document analysis and payment management",
      },
      {
        type: "a2a",
        url: `https://${domain}/api`,
        description: "Agent-to-Agent API for document analysis and payment operations",
      },
    ],
    agentWallet: walletAddress,
    metadata: {
      capabilities: [
        "legal-document-analysis",
        "usdc-payment-processing",
        "uniswap-autonomous-swaps",
        "eip712-delegation",
        "telegram-communication",
        "locus-treasury-management",
      ],
      chain: "base",
      chainId: 8453,
      registryAddress: IDENTITY_REGISTRY,
      reputationRegistryAddress: REPUTATION_REGISTRY,
      agentId: _agentId,
    },
  };
}

export function getIdentityStatus(): AgentIdentity {
  if (_lastCheckResult) {
    if (_agentId !== null) {
      _lastCheckResult.agentId = _agentId;
    }
    return _lastCheckResult;
  }
  return {
    registered: _agentId !== null || (_lastCheckResult?.registered ?? false),
    agentId: _agentId ?? undefined,
    registryAddress: IDENTITY_REGISTRY,
    reputationRegistryAddress: REPUTATION_REGISTRY,
    walletAddress: getAgentWallet(),
    registrationTxHash: _registrationTxHash ?? undefined,
  };
}

async function deepScanForAgentId(): Promise<void> {
  if (_agentId !== null) return;
  const walletAddress = getAgentWallet();
  const publicClient = createPublicClient({ chain: base, transport });
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

  try {
    const currentBlock = await publicClient.getBlockNumber();
    const CHUNK = 9000n;
    let toBlock = currentBlock;

    for (let i = 0; i < 50 && toBlock > 0n; i++) {
      const fromBlock = toBlock > CHUNK ? toBlock - CHUNK : 0n;
      try {
        const logs = await publicClient.getLogs({
          address: IDENTITY_REGISTRY,
          event: {
            type: "event",
            name: "Transfer",
            inputs: [
              { name: "from", type: "address", indexed: true },
              { name: "to", type: "address", indexed: true },
              { name: "tokenId", type: "uint256", indexed: true },
            ],
          },
          args: {
            from: ZERO_ADDRESS,
            to: walletAddress as `0x${string}`,
          },
          fromBlock,
          toBlock,
        });

        if (logs.length > 0) {
          const tokenId = logs[0].args.tokenId;
          if (tokenId !== undefined) {
            _agentId = Number(tokenId);
            console.log(`[ERC-8004] Found agent ID via deep scan: ${_agentId}`);
            store.addActivity("system", `ERC-8004 Agent ID resolved: ${_agentId}`);
            return;
          }
        }
      } catch {
        // skip chunk
      }
      toBlock = fromBlock - 1n;
      await new Promise(r => setTimeout(r, 500));
    }
    console.log("[ERC-8004] Deep scan: agent ID not found in scanned range");
  } catch (err) {
    console.error("[ERC-8004] Deep scan failed:", err);
  }
}

export async function initERC8004(): Promise<void> {
  console.log("[ERC-8004] Initializing agent identity...");

  const identity = await checkRegistration();
  if (identity.registered) {
    if (identity.agentId !== undefined) {
      console.log(`[ERC-8004] Agent registered with ID: ${identity.agentId}`);
      store.addActivity("system", `ERC-8004 identity verified — Agent ID: ${identity.agentId}`);
    } else {
      console.log("[ERC-8004] Agent registered but ID unknown — starting background scan");
      store.addActivity("system", "ERC-8004 identity registered on-chain — resolving agent ID...");
      deepScanForAgentId();
    }
  } else {
    console.log("[ERC-8004] Agent not registered — attempting auto-registration...");
    const account = getAccount();
    if (account) {
      const regResult = await registerAgent();
      if (regResult.success) {
        console.log(`[ERC-8004] Auto-registered agent with ID: ${regResult.agentId}`);
      } else {
        console.log(`[ERC-8004] Auto-registration failed: ${regResult.error}`);
        store.addActivity("system", `ERC-8004: Auto-registration failed — ${regResult.error}`);
      }
    } else {
      console.log("[ERC-8004] No PRIVATE_KEY — cannot auto-register");
      store.addActivity("system", "ERC-8004: Agent not registered — PRIVATE_KEY required for registration");
    }
  }
}

function stringToBytes32(str: string): Hex {
  if (!str) return "0x0000000000000000000000000000000000000000000000000000000000000000";
  const hex = Buffer.from(str.slice(0, 32)).toString("hex").padEnd(64, "0");
  return `0x${hex}` as Hex;
}
