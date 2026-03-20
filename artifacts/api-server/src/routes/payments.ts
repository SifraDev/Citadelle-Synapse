import { Router, type IRouter } from "express";
import { store } from "../lib/store.js";
import { getUsdcBalance, getEthBalance, getAgentWallet, getUsdcAddress, verifyTransaction } from "../lib/crypto.js";
import { sendMessage } from "../lib/telegram.js";
import {
  isLocusConfigured,
  getLocusBalance,
  getLocusWalletAddress,
  getLocusTransactions,
  locusSendPayment,
} from "../lib/locus.js";
import {
  storeDelegation,
  getDelegationStatus,
  getEIP712DelegationTypes,
} from "../lib/delegation.js";
import {
  isUniswapConfigured,
  performAutonomousSwap,
  getSwapConfig,
} from "../lib/uniswap.js";

const router: IRouter = Router();

router.get("/payments", async (req, res): Promise<void> => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const payments = store.getPayments(limit);
  res.json(payments);
});

router.get("/payments/wallet", async (_req, res): Promise<void> => {
  try {
    const [onChainBalance, ethBalance, locusInfo] = await Promise.all([
      getUsdcBalance(),
      getEthBalance(),
      isLocusConfigured() ? getLocusBalance() : null,
    ]);

    res.json({
      address: getAgentWallet(),
      usdcBalance: onChainBalance,
      ethBalance,
      usdcContract: getUsdcAddress(),
      network: "Base",
      chainId: 8453,
      uniswapConfigured: isUniswapConfigured(),
      locus: locusInfo
        ? {
            connected: true,
            walletAddress: locusInfo.wallet_address,
            balance: locusInfo.usdc_balance,
            chain: locusInfo.chain,
            allowance: locusInfo.allowance,
          }
        : { connected: false },
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch wallet info" });
  }
});

router.get("/payments/charges", async (_req, res): Promise<void> => {
  const charges = store.listCharges();
  res.json(charges);
});

router.post("/payments/charge", async (req, res): Promise<void> => {
  const { amount, label } = req.body;
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  const charge = store.addCharge(String(Number(amount)), label);

  const locusWallet = await getLocusWalletAddress();
  if (locusWallet) {
    store.updateCharge(charge.id, { locusWalletAddress: locusWallet });
  }

  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || "";
  const payUrl = domain ? `https://${domain}/pay/${charge.id}` : `/pay/${charge.id}`;

  const walletDisplay = locusWallet || getAgentWallet();
  await sendMessage(
    `💳 <b>New Charge Created</b>\n\nAmount: ${charge.amount} USDC\n${label ? `Client: ${label}\n` : ""}Wallet: <code>${walletDisplay}</code>\nPayment Link: <a href="${payUrl}">${payUrl}</a>\n${locusWallet ? "💎 <i>Powered by Locus</i>" : ""}`
  );

  res.status(201).json({
    ...charge,
    locusWalletAddress: locusWallet || undefined,
    paymentUrl: payUrl,
  });
});

router.get("/payments/charge/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const charge = store.getCharge(id);
  if (!charge) {
    res.status(404).json({ error: "Charge not found" });
    return;
  }

  const walletAddress = charge.locusWalletAddress || getAgentWallet();

  res.json({
    ...charge,
    walletAddress,
    usdcContract: getUsdcAddress(),
    network: "Base",
    chainId: 8453,
    paymentMethod: charge.locusWalletAddress ? "locus" : "direct",
  });
});

router.post("/payments/confirm", async (req, res): Promise<void> => {
  const { txHash, chargeId } = req.body;
  if (!txHash) {
    res.status(400).json({ error: "txHash is required" });
    return;
  }

  const existingPayments = store.getPayments(500);
  if (existingPayments.some((p) => p.txHash === txHash)) {
    res.status(409).json({ error: "Transaction already recorded" });
    return;
  }

  let charge: ReturnType<typeof store.getCharge> = undefined;
  if (chargeId) {
    charge = store.getCharge(chargeId);
    if (!charge) {
      res.status(404).json({ error: "Charge not found" });
      return;
    }
    if (charge.status !== "pending") {
      res.status(400).json({ error: `Charge is already ${charge.status}` });
      return;
    }
  }

  const isLocusCharge = !!charge?.locusWalletAddress;
  const expectedRecipient = isLocusCharge ? charge!.locusWalletAddress! : getAgentWallet();

  let verification: { verified: boolean; from?: string; to?: string; amount?: string; error?: string };
  let verifiedViaLocus = false;

  if (isLocusCharge && isLocusConfigured()) {
    const locusTxData = await getLocusTransactions(50);
    const locusTx = locusTxData?.transactions.find((tx) => tx.tx_hash === txHash);
    const isIncoming = locusTx && (locusTx.type === "receive" || locusTx.type === "incoming" || locusTx.type === "credit");
    const isConfirmed = locusTx && (locusTx.status === "confirmed" || locusTx.status === "completed" || locusTx.status === "success");
    const recipientMatch = locusTx && locusTx.to_address?.toLowerCase() === expectedRecipient.toLowerCase();
    if (locusTx && isIncoming && isConfirmed && recipientMatch) {
      verification = {
        verified: true,
        from: locusTx.from_address,
        to: locusTx.to_address,
        amount: locusTx.amount,
      };
      verifiedViaLocus = true;
    } else {
      verification = await verifyTransaction(txHash, expectedRecipient);
    }
  } else {
    verification = await verifyTransaction(txHash, expectedRecipient);
  }

  if (!verification.verified) {
    res.status(400).json({ error: verification.error || "Transaction verification failed" });
    return;
  }

  if (charge) {
    const verifiedAmount = parseFloat(verification.amount || "0");
    const chargeAmount = parseFloat(charge.amount);
    if (Math.abs(verifiedAmount - chargeAmount) > 0.01) {
      res.status(400).json({
        error: `Amount mismatch: charge requires ${charge.amount} USDC but transaction sent ${verification.amount} USDC`,
      });
      return;
    }
    store.updateCharge(chargeId!, {
      status: "paid",
      txHash,
      paidAt: new Date().toISOString(),
      paidFrom: verification.from,
    });
  }

  const payment = store.addPayment({
    txHash,
    from: verification.from || "unknown",
    to: verification.to || expectedRecipient,
    amount: verification.amount || "0",
    token: "USDC",
    status: "confirmed",
    timestamp: new Date().toISOString(),
    network: isLocusCharge ? "Base (Locus)" : "Base",
    paymentMethod: isLocusCharge ? "locus" : "direct",
  });

  const verifyMethod = verifiedViaLocus ? "Locus" : "on-chain";
  await sendMessage(
    `💰 <b>Payment Verified (${verifyMethod})</b>\n\nAmount: ${verification.amount} USDC\nFrom: <code>${verification.from}</code>\nTx: <a href="https://basescan.org/tx/${txHash}">${txHash.slice(0, 16)}...</a>${isLocusCharge ? "\n💎 <i>Via Locus wallet</i>" : ""}`
  );

  res.json(payment);
});

router.delete("/payments/charge/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const charge = store.getCharge(id);
  if (!charge) {
    res.status(404).json({ error: "Charge not found" });
    return;
  }
  if (charge.status === "paid") {
    res.status(400).json({ error: "Cannot delete a paid charge" });
    return;
  }
  store.updateCharge(id, { status: "expired" });
  store.addActivity("payment", `Charge ${id.slice(0, 8)}... cancelled/expired`);
  res.json({ message: "Charge cancelled" });
});

router.get("/payments/locus/transactions", async (req, res): Promise<void> => {
  if (!isLocusConfigured()) {
    res.status(503).json({ error: "Locus not configured" });
    return;
  }

  const limit = parseInt(req.query.limit as string, 10) || 50;
  const offset = parseInt(req.query.offset as string, 10) || 0;
  const txData = await getLocusTransactions(limit, offset);

  if (!txData) {
    res.status(500).json({ error: "Failed to fetch Locus transactions" });
    return;
  }

  res.json(txData);
});

router.post("/payments/locus/send", async (req, res): Promise<void> => {
  const adminToken = process.env.ADMIN_API_TOKEN;
  const authHeader = req.headers.authorization;
  if (!adminToken || !authHeader || authHeader !== `Bearer ${adminToken}`) {
    res.status(403).json({ error: "Unauthorized: admin token required" });
    return;
  }

  if (!isLocusConfigured()) {
    res.status(503).json({ error: "Locus not configured" });
    return;
  }

  const { to_address, amount, memo } = req.body;
  if (!to_address || !amount || !memo) {
    res.status(400).json({ error: "to_address, amount, and memo are required" });
    return;
  }

  if (typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number" });
    return;
  }

  const result = await locusSendPayment(to_address, amount, memo);

  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }

  store.addPayment({
    txHash: result.tx_hash,
    from: (await getLocusWalletAddress()) || "locus-wallet",
    to: to_address,
    amount: String(amount),
    token: "USDC",
    status: "confirmed",
    timestamp: new Date().toISOString(),
    network: "Base (Locus)",
    paymentMethod: "locus",
  });

  await sendMessage(
    `💸 <b>USDC Sent via Locus</b>\n\nAmount: ${amount} USDC\nTo: <code>${to_address}</code>\nMemo: ${memo}\nTx: <a href="https://basescan.org/tx/${result.tx_hash}">${result.tx_hash.slice(0, 16)}...</a>`
  );

  res.json(result);
});

router.get("/payments/delegation", async (_req, res): Promise<void> => {
  const status = getDelegationStatus();
  const types = getEIP712DelegationTypes();
  res.json({ ...status, eip712: types });
});

router.post("/payments/delegation", async (req, res): Promise<void> => {
  const { delegator, delegate, allowedContract, dailyLimitUsdc, expiresAt, signature } = req.body;

  if (!delegator || !delegate || !allowedContract || !dailyLimitUsdc || !expiresAt || !signature) {
    res.status(400).json({ error: "All delegation fields are required" });
    return;
  }

  const result = await storeDelegation(delegator, delegate, allowedContract, dailyLimitUsdc, expiresAt, signature);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }

  await sendMessage(
    `🔑 <b>Delegation Granted</b>\n\nDelegator: <code>${delegator.slice(0, 10)}...</code>\nAgent: <code>${delegate.slice(0, 10)}...</code>\nDaily Limit: ${dailyLimitUsdc} USDC\nExpires: ${new Date(expiresAt * 1000).toISOString()}`
  );

  res.json(getDelegationStatus());
});

router.post("/payments/swap", async (req, res): Promise<void> => {
  const adminToken = process.env.ADMIN_API_TOKEN;
  const authHeader = req.headers.authorization;
  if (!adminToken || !authHeader || authHeader !== `Bearer ${adminToken}`) {
    res.status(403).json({ error: "Unauthorized: admin token required" });
    return;
  }

  if (!isUniswapConfigured()) {
    res.status(503).json({ error: "Uniswap not configured (missing UNISWAP_API_KEY or PRIVATE_KEY)" });
    return;
  }

  const { amount } = req.body;
  if (!amount || typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "amount must be a positive number (USDC)" });
    return;
  }

  const result = await performAutonomousSwap(amount);
  if (!result.success) {
    const status = result.delegationDenied ? 403 : 400;
    res.status(status).json({ error: result.error || result.reason, delegationDenied: result.delegationDenied });
    return;
  }

  res.json(result);
});

export default router;
