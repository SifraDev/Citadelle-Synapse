import { Router, type IRouter } from "express";
import { SendTelegramMessageBody } from "@workspace/api-zod";
import { getBotStatus, sendMessage } from "../lib/telegram.js";

const router: IRouter = Router();

router.get("/telegram/status", async (_req, res): Promise<void> => {
  const status = getBotStatus();
  res.json(status);
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
