import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  parseUnits,
  type Hex,
} from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { store } from "./store.js";
import { sendMessage } from "./telegram.js";
import { verifyDelegation, recordDailyUsage } from "./delegation.js";
import { getAgentWallet } from "./crypto.js";

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const ETH_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const UNISWAP_UNIVERSAL_ROUTER = "0x6fF5693b99212Da76ad316178A184AB56D299b43" as const;
const USDC_DECIMALS = 6;
const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const BASE_CHAIN_ID = 8453;

const COMMISSION_RATE = parseFloat(process.env.COMMISSION_RATE || "0.10");
const MIN_SWAP_THRESHOLD = parseFloat(process.env.MIN_SWAP_THRESHOLD || "0.50");

const ERC20_ABI = parseAbi([
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const transport = http("https://mainnet.base.org");

export interface SwapQuote {
  quote: {
    input: { amount: string; token: string };
    output: { amount: string; token: string };
  };
  routing: string;
  permitData?: unknown;
  gasFee?: string;
}

export interface SwapResult {
  success: boolean;
  txHash?: string;
  amountIn?: string;
  amountOut?: string;
  error?: string;
  delegationDenied?: boolean;
  reason?: string;
}

function getApiKey(): string | null {
  return process.env.UNISWAP_API_KEY || null;
}

function getAccount() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return null;
  return privateKeyToAccount(pk.startsWith("0x") ? (pk as `0x${string}`) : `0x${pk}`);
}

export function isUniswapConfigured(): boolean {
  return !!getApiKey() && !!process.env.PRIVATE_KEY;
}

export function getSwapConfig() {
  return {
    commissionRate: COMMISSION_RATE,
    minSwapThreshold: MIN_SWAP_THRESHOLD,
  };
}

interface UniswapQuoteResponse {
  quote: {
    input?: { amount: string; token: string };
    output?: { amount: string; token: string };
    methodParameters?: { calldata: string; value: string; to: string };
  };
  routing?: string;
  permitData?: PermitData;
}

interface PermitData {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType?: string;
  values: Record<string, unknown>;
}

export async function getSwapQuote(usdcAmount: number): Promise<{
  success: boolean;
  data?: UniswapQuoteResponse;
  error?: string;
}> {
  const apiKey = getApiKey();
  if (!apiKey) return { success: false, error: "UNISWAP_API_KEY not set" };

  const account = getAccount();
  if (!account) return { success: false, error: "PRIVATE_KEY not set" };

  const amountRaw = parseUnits(usdcAmount.toString(), USDC_DECIMALS).toString();

  try {
    const response = await fetch(`${UNISWAP_API_BASE}/quote`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        tokenInChainId: BASE_CHAIN_ID,
        tokenOutChainId: BASE_CHAIN_ID,
        tokenIn: USDC_ADDRESS,
        tokenOut: ETH_ADDRESS,
        amount: amountRaw,
        type: "EXACT_INPUT",
        swapper: account.address,
        protocols: ["V3"],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[Uniswap] Quote error:", response.status, errBody);
      return { success: false, error: `Quote API error: ${response.status} — ${errBody.slice(0, 200)}` };
    }

    const data = (await response.json()) as UniswapQuoteResponse;
    return { success: true, data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Quote request failed: ${msg}` };
  }
}

export async function ensurePermit2Approval(): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
  alreadyApproved?: boolean;
}> {
  const account = getAccount();
  if (!account) return { success: false, error: "PRIVATE_KEY not set" };

  try {
    const publicClient = createPublicClient({ chain: base, transport });

    const currentAllowance = (await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [account.address, PERMIT2_ADDRESS],
    })) as bigint;

    const threshold = parseUnits("1000000", USDC_DECIMALS);
    if (currentAllowance >= threshold) {
      return { success: true, alreadyApproved: true };
    }

    const walletClient = createWalletClient({
      account,
      chain: base,
      transport,
    });

    const maxApproval = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    const txHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, maxApproval],
    });

    console.log(`[Uniswap] Permit2 approval tx: ${txHash}`);
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    return { success: true, txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Permit2 approval failed: ${msg}` };
  }
}

export async function executeSwap(quoteResponse: UniswapQuoteResponse): Promise<{
  success: boolean;
  txHash?: string;
  error?: string;
}> {
  const apiKey = getApiKey();
  const account = getAccount();
  if (!apiKey || !account) return { success: false, error: "Missing API key or private key" };

  try {
    const orderResponse = await fetch(`${UNISWAP_API_BASE}/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        quote: quoteResponse.quote,
        signature: quoteResponse.permitData
          ? await signPermitData(quoteResponse.permitData, account)
          : "0x",
        chainId: BASE_CHAIN_ID,
      }),
    });

    if (!orderResponse.ok) {
      const errBody = await orderResponse.text();

      if (quoteResponse.quote?.methodParameters) {
        return await executeViaDirectTx(quoteResponse.quote.methodParameters, account);
      }
      return { success: false, error: `Order API error: ${orderResponse.status} — ${errBody.slice(0, 200)}` };
    }

    const orderData = (await orderResponse.json()) as { orderHash?: string; txHash?: string };

    if (orderData.txHash) {
      return { success: true, txHash: orderData.txHash };
    }

    if (orderData.orderHash) {
      const txHash = await pollOrderStatus(orderData.orderHash, apiKey);
      return txHash
        ? { success: true, txHash }
        : { success: false, error: "Order submitted but tx hash not confirmed in time" };
    }

    if (quoteResponse.quote?.methodParameters) {
      return await executeViaDirectTx(quoteResponse.quote.methodParameters, account);
    }

    return { success: false, error: "No order hash or tx data returned" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Swap execution failed: ${msg}` };
  }
}

async function signPermitData(permitData: PermitData, account: ReturnType<typeof privateKeyToAccount>): Promise<string> {
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport,
  });

  const signature = await walletClient.signTypedData({
    domain: permitData.domain,
    types: permitData.types,
    primaryType: permitData.primaryType || "PermitSingle",
    message: permitData.values,
  });

  return signature;
}

async function executeViaDirectTx(
  methodParameters: { calldata: string; value: string; to: string },
  account: ReturnType<typeof privateKeyToAccount>
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  if (methodParameters.to.toLowerCase() !== UNISWAP_UNIVERSAL_ROUTER.toLowerCase()) {
    return {
      success: false,
      error: `Transaction target ${methodParameters.to} does not match allowed Uniswap Universal Router (${UNISWAP_UNIVERSAL_ROUTER}) — rejected by delegation contract enforcement`,
    };
  }

  try {
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport,
    });
    const publicClient = createPublicClient({ chain: base, transport });

    const txHash = await walletClient.sendTransaction({
      to: methodParameters.to as `0x${string}`,
      data: methodParameters.calldata as Hex,
      value: BigInt(methodParameters.value || "0"),
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return { success: false, error: "Swap transaction reverted on-chain" };
    }

    return { success: true, txHash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Direct tx execution failed: ${msg}` };
  }
}

async function pollOrderStatus(orderHash: string, apiKey: string): Promise<string | null> {
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await fetch(`${UNISWAP_API_BASE}/order/${orderHash}`, {
        headers: { "x-api-key": apiKey },
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: string; txHash?: string };
        if (data.txHash) return data.txHash;
        if (data.status === "failed" || data.status === "expired") return null;
      }
    } catch {
      // continue polling
    }
  }
  return null;
}

export async function performAutonomousSwap(usdcAmount: number): Promise<SwapResult> {
  console.log(`[Uniswap] Autonomous swap requested: ${usdcAmount} USDC → ETH`);

  if (usdcAmount < MIN_SWAP_THRESHOLD) {
    return { success: false, error: `Amount ${usdcAmount} below minimum threshold ${MIN_SWAP_THRESHOLD} USDC` };
  }

  const account = getAccount();
  if (!account) {
    return { success: false, error: "PRIVATE_KEY not set — cannot sign swap" };
  }

  const agentWallet = getAgentWallet();
  if (account.address.toLowerCase() !== agentWallet.toLowerCase()) {
    return { success: false, error: `Wallet mismatch: PRIVATE_KEY derives ${account.address} but AGENT_WALLET is ${agentWallet}` };
  }

  const delegationCheck = await verifyDelegation(usdcAmount);
  if (!delegationCheck.allowed) {
    console.log(`[Uniswap] Delegation denied: ${delegationCheck.reason}`);
    store.addActivity("system", `Swap blocked — ${delegationCheck.reason}`, {
      amount: usdcAmount,
      action: "swap_denied",
    });
    await sendMessage(
      `🔒 <b>Swap Blocked — Permission Required</b>\n\nAmount: ${usdcAmount} USDC\nReason: ${delegationCheck.reason}\n\nPlease sign a delegation in the dashboard.`
    );
    return { success: false, delegationDenied: true, reason: delegationCheck.reason };
  }

  const publicClient = createPublicClient({ chain: base, transport });
  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [account.address],
  }) as bigint;

  const requiredAmount = parseUnits(usdcAmount.toString(), USDC_DECIMALS);
  if (usdcBalance < requiredAmount) {
    const available = formatUnits(usdcBalance, USDC_DECIMALS);
    return { success: false, error: `Insufficient USDC on agent EOA: have ${available}, need ${usdcAmount}` };
  }

  const approvalResult = await ensurePermit2Approval();
  if (!approvalResult.success) {
    return { success: false, error: `Permit2 approval failed: ${approvalResult.error}` };
  }
  if (approvalResult.txHash) {
    store.addActivity("system", `Permit2 USDC approval set (tx: ${approvalResult.txHash.slice(0, 16)}...)`);
  }

  const quoteResult = await getSwapQuote(usdcAmount);
  if (!quoteResult.success || !quoteResult.data) {
    return { success: false, error: quoteResult.error || "Failed to get quote" };
  }

  const quoteData = quoteResult.data;
  const outputAmount = quoteData.quote?.output?.amount
    ? formatUnits(BigInt(quoteData.quote.output.amount), 18)
    : "unknown";

  console.log(`[Uniswap] Quote received: ${usdcAmount} USDC → ${outputAmount} ETH`);

  const swapResult = await executeSwap(quoteData);
  if (!swapResult.success) {
    return { success: false, error: swapResult.error };
  }

  recordDailyUsage(usdcAmount);

  store.addPayment({
    txHash: swapResult.txHash,
    from: getAccount()?.address || "agent-eoa",
    to: "Uniswap (USDC→ETH)",
    amount: usdcAmount.toString(),
    token: "USDC→ETH",
    status: "confirmed",
    timestamp: new Date().toISOString(),
    network: "Base (Swap)",
    paymentMethod: "swap",
  });

  store.addActivity("payment", `Swap executed: ${usdcAmount} USDC → ${outputAmount} ETH`, {
    txHash: swapResult.txHash,
    amountIn: usdcAmount.toString(),
    amountOut: outputAmount,
    via: "uniswap",
  });

  await sendMessage(
    `⚡ <b>USDC→ETH Swap Executed</b>\n\nIn: ${usdcAmount} USDC\nOut: ~${parseFloat(outputAmount).toFixed(6)} ETH\nTx: <a href="https://basescan.org/tx/${swapResult.txHash}">${swapResult.txHash?.slice(0, 16)}...</a>\nVia: Uniswap on Base`
  );

  return {
    success: true,
    txHash: swapResult.txHash,
    amountIn: usdcAmount.toString(),
    amountOut: outputAmount,
  };
}

export function calculateCommission(paymentAmount: string): number {
  const amount = parseFloat(paymentAmount);
  return parseFloat((amount * COMMISSION_RATE).toFixed(6));
}
