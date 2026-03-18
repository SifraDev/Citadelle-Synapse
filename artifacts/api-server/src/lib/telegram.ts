import TelegramBot from "node-telegram-bot-api";
import { store } from "./store.js";

let bot: TelegramBot | null = null;
let botInfo: { username: string } | null = null;
let isInitialized = false;

export function initTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[Telegram] TELEGRAM_BOT_TOKEN not set, bot disabled");
    return;
  }

  if (isInitialized) {
    return;
  }

  try {
    bot = new TelegramBot(token, { polling: true });
    isInitialized = true;

    bot.getMe().then((me) => {
      botInfo = { username: me.username || "unknown" };
      console.log(`[Telegram] Bot connected as @${botInfo.username}`);
      store.addActivity("telegram", `Telegram bot connected as @${botInfo.username}`);
    }).catch((err) => {
      console.error("[Telegram] Failed to get bot info:", err.message);
    });

    bot.on("message", (msg) => {
      const chatId = msg.chat.id.toString();
      const text = msg.text || "";

      store.addActivity("telegram", `Message from ${msg.from?.username || "unknown"}: ${text}`, {
        chatId,
        fromUser: msg.from?.username,
      });

      if (text.startsWith("/approve")) {
        store.addActivity("telegram", `Action APPROVED by ${msg.from?.username || "unknown"}`, {
          chatId,
          action: "approve",
        });
        bot?.sendMessage(Number(chatId), "✅ Action approved and recorded.");
      } else if (text.startsWith("/reject")) {
        store.addActivity("telegram", `Action REJECTED by ${msg.from?.username || "unknown"}`, {
          chatId,
          action: "reject",
        });
        bot?.sendMessage(Number(chatId), "❌ Action rejected and recorded.");
      } else if (text.startsWith("/pay")) {
        const parts = text.split(" ");
        if (parts.length >= 3) {
          const amount = parts[1];
          const token = parts[2].toUpperCase();
          store.addPayment({
            amount,
            token,
            status: "pending",
            timestamp: new Date().toISOString(),
            from: msg.from?.username || "unknown",
            network: "ethereum",
          });
          bot?.sendMessage(Number(chatId), `💰 Payment of ${amount} ${token} logged as pending.`);
        }
      }
    });

    bot.on("polling_error", (err) => {
      if ((err as any)?.response?.statusCode === 409) {
        console.log("[Telegram] 409 Conflict - another instance running, stopping polling");
        bot?.stopPolling();
        isInitialized = false;
      } else {
        console.error("[Telegram] Polling error:", err.message);
      }
    });
  } catch (err: any) {
    console.error("[Telegram] Failed to initialize bot:", err.message);
  }
}

export async function sendMessage(message: string, chatId?: string): Promise<boolean> {
  if (!bot) return false;
  const targetChat = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!targetChat) return false;

  try {
    await bot.sendMessage(Number(targetChat), message, { parse_mode: "HTML" });
    store.addActivity("telegram", `Message sent to chat ${targetChat}`);
    return true;
  } catch (err: any) {
    console.error("[Telegram] Send error:", err.message);
    return false;
  }
}

export function getBotStatus(): { connected: boolean; botUsername?: string; chatId?: string } {
  return {
    connected: isInitialized && bot !== null,
    botUsername: botInfo?.username,
    chatId: process.env.TELEGRAM_CHAT_ID,
  };
}

export function stopBot(): void {
  if (bot) {
    bot.stopPolling();
    bot = null;
    isInitialized = false;
  }
}
