import { Router, type IRouter } from "express";
import { z } from "zod";
import { getBotStatus, sendMessage } from "../lib/telegram.js";

const SendTelegramMessageBody = z.object({
  message: z.string(),
  chatId: z.string().optional(),
});

const router: IRouter = Router();

router.get("/telegram/status", async (_req, res): Promise<void> => {
  const status = getBotStatus();
  const { isLocusConfigured, locusHealthCheck } = await import("../lib/locus.js");
  let locusStatus: { connected: boolean; walletAddress?: string; balance?: string } = { connected: false };
  if (isLocusConfigured()) {
    locusStatus = await locusHealthCheck();
  }
  res.json({ ...status, locus: locusStatus });
});

router.post("/telegram/send", async (req, res): Promise<void> => {
  const parsed = SendTelegramMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const sent = await sendMessage(parsed.data.message, parsed.data.chatId);
  if (!sent) {
    res.status(400).json({ error: "Failed to send message. Bot may not be connected." });
    return;
  }

  res.json({ message: "Message sent successfully" });
});

export default router;
