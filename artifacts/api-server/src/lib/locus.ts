import { store } from "./store.js";
import { sendMessage } from "./telegram.js";
import { getAgentWallet } from "./crypto.js";
import { calculateCommission, performAutonomousSwap, isUniswapConfigured, getSwapConfig, getVvvAddress } from "./uniswap.js";
import { verifyDelegation } from "./delegation.js";
import { recordActionReceipt } from "./erc8004.js";

const LOCUS_API_BASE = "https://beta-api.paywithlocus.com/api";

export interface LocusBalance {
  wallet_address: string;
  chain: string;
  usdc_balance: string;
  allowance: number;
  max_transaction_size: number | null;
}

export interface LocusTransaction {
  id: string;
  type: string;
  amount: string;
  token: string;
  from_address: string;
  to_address: string;
  tx_hash: string;
  status: string;
  memo?: string;
  created_at: string;
}

export interface LocusSendResult {
  tx_hash: string;
  amount: number;
  to_address: string;
  status: string;
}

let _cachedBalance: LocusBalance | null = null;
let _lastBalanceFetch = 0;
let _pollInterval: ReturnType<typeof setInterval> | null = null;
let _lastSeenTxId: string | null = null;

function getApiKey(): string | null {
  return process.env.LOCUS_API_KEY || null;
}

async function locusRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ success: boolean; data?: T; error?: string; message?: string }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { success: false, error: "LOCUS_API_KEY not configured" };
  }

  try {
    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${LOCUS_API_BASE}${path}`, options);
    const json = (await response.json()) as { success?: boolean; data?: T; error?: string; message?: string };

    if (!response.ok || !json.success) {
      return {
        success: false,
        error: json.error || json.message || `HTTP ${response.status}`,
        message: json.message,
      };
    }

    return { success: true, data: json.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: msg };
  }
}

export function isLocusConfigured(): boolean {
  return !!getApiKey();
}

export async function getLocusBalance(): Promise<LocusBalance | null> {
  const now = Date.now();
  if (_cachedBalance && now - _lastBalanceFetch < 10000) {
    return _cachedBalance;
  }

  const result = await locusRequest<LocusBalance>("GET", "/pay/balance");
  if (result.success && result.data) {
    _cachedBalance = result.data;
    _lastBalanceFetch = now;
    return result.data;
  }

  console.error("[Locus] Failed to fetch balance:", result.error);
  return _cachedBalance;
}

export async function getLocusWalletAddress(): Promise<string | null> {
  const balance = await getLocusBalance();
  return balance?.wallet_address || null;
}

export async function getLocusTransactions(
  limit = 50,
  offset = 0
): Promise<{ transactions: LocusTransaction[]; total: number } | null> {
  const result = await locusRequest<{
    transactions: LocusTransaction[];
    pagination: { total: number; limit: number; offset: number; has_more: boolean };
  }>("GET", `/pay/transactions?limit=${limit}&offset=${offset}`);

  if (result.success && result.data) {
    return {
      transactions: result.data.transactions,
      total: result.data.pagination.total,
    };
  }

  console.error("[Locus] Failed to fetch transactions:", result.error);
  return null;
}

export async function locusSendPayment(
  toAddress: string,
  amount: number,
  memo: string
): Promise<LocusSendResult | { error: string }> {
  const result = await locusRequest<LocusSendResult>("POST", "/pay/send", {
    to_address: toAddress,
    amount,
    memo,
  });

  if (result.success && result.data) {
    console.log(`[Locus] Payment sent: ${amount} USDC to ${toAddress} (tx: ${result.data.tx_hash})`);
    store.addActivity("payment", `Locus payment sent: ${amount} USDC to ${toAddress.slice(0, 10)}...`, {
      txHash: result.data.tx_hash,
      to: toAddress,
      amount: String(amount),
      via: "locus",
    });
    return result.data;
  }

  const error = result.message || result.error || "Send failed";
  console.error("[Locus] Send payment failed:", error);
  return { error };
}

export async function locusHealthCheck(): Promise<{
  connected: boolean;
  walletAddress?: string;
  balance?: string;
  chain?: string;
  allowance?: number;
}> {
  const balance = await getLocusBalance();
  if (!balance) {
    return { connected: false };
  }

  console.log(
    `[Locus] Treasury connected: ${balance.usdc_balance} USDC | Wallet: ${balance.wallet_address} | Allowance: ${balance.allowance} USDC`
  );

  return {
    connected: true,
    walletAddress: balance.wallet_address,
    balance: balance.usdc_balance,
    chain: balance.chain,
    allowance: balance.allowance,
  };
}

async function pollLocusTransactions(): Promise<void> {
  try {
    const txData = await getLocusTransactions(10);
    if (!txData || txData.transactions.length === 0) return;

    const incoming = txData.transactions.filter(
      (tx) => tx.type === "receive" || tx.type === "incoming" || tx.type === "credit"
    );

    for (const tx of incoming) {
      if (_lastSeenTxId && tx.id === _lastSeenTxId) break;

      const existingPayments = store.getPayments(500);
      if (tx.tx_hash && existingPayments.some((p) => p.txHash === tx.tx_hash)) continue;

      const amount = tx.amount;
      const charges = store.listCharges();
      const matchedCharge = charges.find(
        (c) =>
          c.status === "pending" &&
          Math.abs(parseFloat(c.amount) - parseFloat(amount)) < 0.01
      );

      if (matchedCharge) {
        store.updateCharge(matchedCharge.id, {
          status: "paid",
          txHash: tx.tx_hash,
          paidAt: tx.created_at || new Date().toISOString(),
          paidFrom: tx.from_address,
        });
      }

      store.addPayment({
        txHash: tx.tx_hash,
        from: tx.from_address,
        to: tx.to_address,
        amount,
        token: tx.token || "USDC",
        status: "confirmed",
        timestamp: tx.created_at || new Date().toISOString(),
        network: "Base (Locus)",
        paymentMethod: "locus",
      });

      await sendMessage(
        `💰 <b>USDC Received via Locus</b>\n\nAmount: ${amount} USDC\nFrom: <code>${tx.from_address}</code>\nTx: <a href="https://basescan.org/tx/${tx.tx_hash}">${tx.tx_hash?.slice(0, 16)}...</a>`
      );

      store.addActivity("payment", `Locus incoming: ${amount} USDC from ${tx.from_address?.slice(0, 10)}...`, {
        txHash: tx.tx_hash,
        from: tx.from_address,
        amount,
        via: "locus",
      });

      recordActionReceipt(
        "payment",
        `Received ${amount} USDC via Locus from ${tx.from_address}`,
        tx.tx_hash,
        amount,
        "USDC",
        tx.from_address
      );

      if (isUniswapConfigured()) {
        const { ethCommission, vvvCommission, total } = calculateCommission(amount);
        const { minSwapThreshold } = getSwapConfig();
        const totalCommission = ethCommission + vvvCommission;
        if (ethCommission >= minSwapThreshold || vvvCommission >= minSwapThreshold) {
          console.log(`[Locus] Commission split: ${ethCommission} USDC→ETH + ${vvvCommission} USDC→VVV (total ${total} from ${amount})`);
          try {
            const delegationCheck = await verifyDelegation(totalCommission);
            if (!delegationCheck.allowed) {
              console.log(`[Locus] Delegation denied before transfer: ${delegationCheck.reason}`);
              store.addActivity("system", `Commission swap skipped — ${delegationCheck.reason}`, { amount: totalCommission });
              await sendMessage(
                `🔒 <b>Commission Swap Skipped</b>\n\nAmount: ${totalCommission} USDC\nReason: ${delegationCheck.reason}\n\nSign a delegation in the dashboard to enable autonomous swaps.`
              );
            } else {
              const agentWallet = getAgentWallet();
              const sendResult = await locusSendPayment(agentWallet, totalCommission, `Auto-commission ${totalCommission} USDC from payment ${tx.tx_hash?.slice(0, 12)}`);
              if ("error" in sendResult) {
                console.error(`[Locus] Commission transfer failed: ${sendResult.error}`);
                store.addActivity("system", `Commission transfer failed: ${sendResult.error}`, { amount: totalCommission });
              } else {
                console.log(`[Locus] Commission ${totalCommission} USDC sent to agent EOA (tx: ${sendResult.tx_hash})`);
                store.addPayment({
                  txHash: sendResult.tx_hash,
                  from: "Locus Treasury",
                  to: agentWallet,
                  amount: totalCommission.toString(),
                  token: "USDC",
                  status: "confirmed",
                  timestamp: new Date().toISOString(),
                  network: "Base (Commission)",
                  paymentMethod: "locus",
                });

                if (ethCommission >= minSwapThreshold) {
                  try {
                    const ethSwapResult = await performAutonomousSwap(ethCommission);
                    if (!ethSwapResult.success && !ethSwapResult.delegationDenied) {
                      console.error(`[Uniswap] ETH swap failed: ${ethSwapResult.error}`);
                    }
                  } catch (ethErr) {
                    console.error("[Locus] ETH commission swap error:", ethErr);
                  }
                }

                if (vvvCommission >= minSwapThreshold) {
                  try {
                    const vvvSwapResult = await performAutonomousSwap(vvvCommission, getVvvAddress());
                    if (!vvvSwapResult.success && !vvvSwapResult.delegationDenied) {
                      console.error(`[Uniswap] VVV swap failed: ${vvvSwapResult.error}`);
                    }
                  } catch (vvvErr) {
                    console.error("[Locus] VVV commission swap error:", vvvErr);
                  }
                }
              }
            }
          } catch (err) {
            console.error("[Locus] Commission/swap pipeline error:", err);
          }
        } else {
          console.log(`[Locus] Commission ${totalCommission} USDC below threshold ${minSwapThreshold}, skipping swap`);
        }
      }
    }

    if (incoming.length > 0) {
      _lastSeenTxId = incoming[0].id;
    }
  } catch (err) {
    console.error("[Locus] Transaction poll error:", err);
  }
}

export async function startLocusMonitor(): Promise<void> {
  if (_pollInterval) return;
  if (!isLocusConfigured()) {
    console.log("[Locus] Not configured, skipping monitor");
    return;
  }

  const txData = await getLocusTransactions(1);
  if (txData && txData.transactions.length > 0) {
    _lastSeenTxId = txData.transactions[0].id;
  }

  console.log("[Locus] Starting transaction monitor (20s interval)");
  store.addActivity("system", "Locus transaction monitor started");

  _pollInterval = setInterval(pollLocusTransactions, 20000);
}

export function stopLocusMonitor(): void {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}
