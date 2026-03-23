import type { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import { getAgentWallet, getUsdcAddress, verifyTransaction } from "./crypto.js";
import { addAgentLogEntry } from "./erc8004.js";
import { store } from "./store.js";
import { sendMessage } from "./telegram.js";
import { trackCall } from "./budget.js";

const X402_PRICE_PER_PAGE = parseFloat(process.env.X402_PRICE_PER_PAGE || "0.50");
const X402_BASE_PRICE = parseFloat(process.env.X402_BASE_PRICE || "1.00");

const consumedTxHashes = new Map<string, { usedAt: string; amount: string }>();

export function getX402PricingInfo() {
  return {
    protocol: "x402",
    version: "1.0",
    services: [
      {
        endpoint: "/api/analyze",
        description: "Legal document analysis via Venice AI",
        pricing: {
          basePrice: X402_BASE_PRICE,
          pricePerPage: X402_PRICE_PER_PAGE,
          currency: "USDC",
          chain: "Base",
          chainId: 8453,
        },
      },
    ],
    paymentDetails: {
      recipient: getAgentWallet(),
      token: getUsdcAddress(),
      chain: "Base",
      chainId: 8453,
      network: "base-mainnet",
    },
    capabilities: ["legal-document-analysis", "risk-flagging", "clause-extraction"],
  };
}

function buildPaymentRequiredResponse() {
  return {
    status: 402,
    protocol: "x402",
    message: "Payment required. Send USDC to the recipient address and include the transaction hash in the X-Payment-TxHash header.",
    paymentDetails: {
      recipient: getAgentWallet(),
      token: getUsdcAddress(),
      tokenSymbol: "USDC",
      chain: "Base",
      chainId: 8453,
      minimumAmount: X402_BASE_PRICE.toString(),
      pricePerPage: X402_PRICE_PER_PAGE.toString(),
      currency: "USDC",
    },
    headers: {
      required: "X-Payment-TxHash",
      description: "Transaction hash of USDC payment to recipient address",
    },
    discoveryEndpoint: "/api/x402/info",
  };
}

function isInternalRequest(req: Request): boolean {
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken) return false;

  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${adminToken}`) return true;

  const dashboardToken = req.headers["x-dashboard-token"] as string | undefined;
  if (dashboardToken) {
    const expected = createHash("sha256")
      .update(`dashboard-session:${adminToken}`)
      .digest("hex");
    if (dashboardToken === expected) return true;
  }

  return false;
}

export interface X402PaymentContext {
  txHash: string;
  from: string;
  amount: string;
}

export function x402Middleware(req: Request, res: Response, next: NextFunction): void {
  if (isInternalRequest(req)) {
    next();
    return;
  }

  const txHash = req.get("X-Payment-TxHash") || (req.query["payment_tx"] as string);

  if (!txHash) {
    addAgentLogEntry({
      type: "payment",
      description: "x402 payment required — returned 402 to external caller",
      decision: {
        trigger: `External request to ${req.path} without payment proof`,
        plan: "Return HTTP 402 with payment facilitation body",
        execution: "Constructed x402 payment-required response with recipient, token, pricing",
        verification: "Response includes all required x402 fields",
        outcome: "Caller informed of payment requirements",
      },
    });
    res.status(402).json(buildPaymentRequiredResponse());
    return;
  }

  if (consumedTxHashes.has(txHash)) {
    res.status(402).json({
      ...buildPaymentRequiredResponse(),
      error: "Transaction hash already consumed. Each payment is single-use.",
      providedTxHash: txHash,
    });
    return;
  }

  const pageCount = parseInt(req.get("X-Page-Count") || "1", 10);
  const requiredAmount = X402_BASE_PRICE + X402_PRICE_PER_PAGE * Math.max(0, pageCount - 1);

  trackCall("rpc");
  verifyTransaction(txHash)
    .then((result) => {
      if (!result.verified) {
        res.status(402).json({
          ...buildPaymentRequiredResponse(),
          error: `Payment verification failed: ${result.error}`,
          providedTxHash: txHash,
        });
        return;
      }

      const amount = parseFloat(result.amount || "0");
      if (amount < requiredAmount) {
        res.status(402).json({
          ...buildPaymentRequiredResponse(),
          error: `Insufficient payment: sent ${result.amount} USDC, required ${requiredAmount.toFixed(2)} USDC (base ${X402_BASE_PRICE} + ${pageCount} pages)`,
          providedTxHash: txHash,
        });
        return;
      }

      consumedTxHashes.set(txHash, { usedAt: new Date().toISOString(), amount: result.amount || "0" });

      store.addPayment({
        txHash,
        from: result.from || "unknown",
        to: result.to || getAgentWallet(),
        amount: result.amount || "0",
        token: "USDC",
        status: "confirmed",
        timestamp: new Date().toISOString(),
        network: "Base (x402)",
        paymentMethod: "direct",
      });

      store.addActivity("payment", `x402 payment received: ${result.amount} USDC from ${result.from?.slice(0, 10)}...`, {
        txHash,
        protocol: "x402",
      });

      sendMessage(
        `💳 <b>x402 Payment Received</b>\n\nAmount: ${result.amount} USDC\nFrom: <code>${result.from}</code>\nProtocol: x402\nTx: <a href="https://basescan.org/tx/${txHash}">${txHash.slice(0, 16)}...</a>`
      );

      const paymentCtx: X402PaymentContext = {
        txHash,
        from: result.from || "unknown",
        amount: result.amount || "0",
      };
      (req as Request & { _x402Payment?: X402PaymentContext })._x402Payment = paymentCtx;

      next();
    })
    .catch((err) => {
      console.error("[x402] Verification error:", err);
      res.status(500).json({ error: "Payment verification failed due to internal error" });
    });
}
