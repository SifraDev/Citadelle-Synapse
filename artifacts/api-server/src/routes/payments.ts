import { Router, type IRouter } from "express";
import { store } from "../lib/store.js";
import { getUsdcBalance, getAgentWallet, getUsdcAddress, verifyTransaction } from "../lib/crypto.js";
import { sendMessage } from "../lib/telegram.js";
import {
  isLocusConfigured,
  getLocusBalance,
  getLocusWalletAddress,
  getLocusTransactions,
  locusSendPayment,
} from "../lib/locus.js";

const router: IRouter = Router();

router.get("/payments", async (req, res): Promise<void> => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const payments = store.getPayments(limit);
  res.json(payments);
});

router.get("/payments/wallet", async (_req, res): Promise<void> => {
  try {
    const [onChainBalance, locusInfo] = await Promise.all([
      getUsdcBalance(),
      isLocusConfigured() ? getLocusBalance() : null,
    ]);

    res.json({
      address: getAgentWallet(),
      usdcBalance: onChainBalance,
      usdcContract: getUsdcAddress(),
      network: "Base",
      chainId: 8453,
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

  const verification = await verifyTransaction(txHash, expectedRecipient);
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

  await sendMessage(
    `💰 <b>Payment Verified On-Chain</b>\n\nAmount: ${verification.amount} USDC\nFrom: <code>${verification.from}</code>\nTx: <a href="https://basescan.org/tx/${txHash}">${txHash.slice(0, 16)}...</a>${isLocusCharge ? "\n💎 <i>Via Locus wallet</i>" : ""}`
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
  const isTelegramInternal = req.headers["x-internal-source"] === "telegram";
  if (!isTelegramInternal) {
    if (!adminToken || !authHeader || authHeader !== `Bearer ${adminToken}`) {
      res.status(403).json({ error: "Unauthorized: admin token required" });
      return;
    }
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

export default router;
