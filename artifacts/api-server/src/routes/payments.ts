import { Router, type IRouter } from "express";
import { store } from "../lib/store.js";
import { getUsdcBalance, getAgentWallet, getUsdcAddress, verifyTransaction } from "../lib/crypto.js";
import { sendMessage } from "../lib/telegram.js";

const router: IRouter = Router();

router.get("/payments", async (req, res): Promise<void> => {
  const limit = parseInt(req.query.limit as string, 10) || 50;
  const payments = store.getPayments(limit);
  res.json(payments);
});

router.get("/payments/wallet", async (_req, res): Promise<void> => {
  try {
    const balance = await getUsdcBalance();
    res.json({
      address: getAgentWallet(),
      usdcBalance: balance,
      usdcContract: getUsdcAddress(),
      network: "Base",
      chainId: 8453,
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

  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || "";
  const payUrl = domain ? `https://${domain}/pay/${charge.id}` : `/pay/${charge.id}`;

  await sendMessage(
    `💳 <b>New Charge Created</b>\n\nAmount: ${charge.amount} USDC\n${label ? `Client: ${label}\n` : ""}Payment Link: <a href="${payUrl}">${payUrl}</a>`
  );

  res.status(201).json({ ...charge, paymentUrl: payUrl });
});

router.get("/payments/charge/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const charge = store.getCharge(id);
  if (!charge) {
    res.status(404).json({ error: "Charge not found" });
    return;
  }
  res.json({
    ...charge,
    walletAddress: getAgentWallet(),
    usdcContract: getUsdcAddress(),
    network: "Base",
    chainId: 8453,
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

  const verification = await verifyTransaction(txHash);
  if (!verification.verified) {
    res.status(400).json({ error: verification.error || "Transaction verification failed" });
    return;
  }

  if (chargeId) {
    const charge = store.getCharge(chargeId);
    if (!charge) {
      res.status(404).json({ error: "Charge not found" });
      return;
    }
    if (charge.status !== "pending") {
      res.status(400).json({ error: `Charge is already ${charge.status}` });
      return;
    }
    const verifiedAmount = parseFloat(verification.amount || "0");
    const chargeAmount = parseFloat(charge.amount);
    if (Math.abs(verifiedAmount - chargeAmount) > 0.01) {
      res.status(400).json({
        error: `Amount mismatch: charge requires ${charge.amount} USDC but transaction sent ${verification.amount} USDC`,
      });
      return;
    }
    store.updateCharge(chargeId, {
      status: "paid",
      txHash,
      paidAt: new Date().toISOString(),
      paidFrom: verification.from,
    });
  }

  const payment = store.addPayment({
    txHash,
    from: verification.from || "unknown",
    to: verification.to || getAgentWallet(),
    amount: verification.amount || "0",
    token: "USDC",
    status: "confirmed",
    timestamp: new Date().toISOString(),
    network: "Base",
  });

  await sendMessage(
    `💰 <b>Payment Verified On-Chain</b>\n\nAmount: ${verification.amount} USDC\nFrom: <code>${verification.from}</code>\nTx: <a href="https://basescan.org/tx/${txHash}">${txHash.slice(0, 16)}...</a>`
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

export default router;
