import TelegramBot from "node-telegram-bot-api";
import { store } from "./store.js";

export let bot: TelegramBot | null = null;
let botInfo: { username: string } | null = null;
export let isInitialized = false;

// Contextual memory (In-memory state machine)
const clientsWaitingForPrice = new Map<string, string>(); // ceoChatId -> clientChatId
const preApprovedInvoices = new Map<string, number>(); // Keyword -> Price

export function initTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ceoChatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    console.log("[Telegram] TELEGRAM_BOT_TOKEN not set, bot disabled");
    return;
  }

  if (isInitialized) return;

  try {
    bot = new TelegramBot(token, { polling: true });
    isInitialized = true;

    // Graceful shutdown
    process.once('SIGINT', () => bot?.stopPolling());
    process.once('SIGTERM', () => bot?.stopPolling());

    bot.getMe().then((me) => {
      botInfo = { username: me.username || "unknown" };
      console.log(`[Telegram] Bot connected as @${botInfo.username}`);
      store.addActivity("telegram", `Telegram bot connected as @${botInfo.username}`);
    }).catch((err) => {
      console.error("[Telegram] Failed to get bot info:", err.message);
    });

    bot.on("message", (msg) => {
      const chatId = msg.chat.id.toString();
      const text = msg.text?.trim() || "";
      const isCEO = ceoChatId && String(chatId) === String(ceoChatId);

      if (!text) return;

      if (isCEO) {
        // --- CONTEXT 1: CEO PROVIDING QUOTE FOR WAITING CLIENT ---
        if (clientsWaitingForPrice.has(chatId) && !isNaN(Number(text))) {
            const clientChatId = clientsWaitingForPrice.get(chatId)!;
            const amount = Number(text);
            clientsWaitingForPrice.delete(chatId);

            bot?.sendMessage(Number(chatId), `✅ **Confirmed.** Sending invoice for ${amount} USDC to the client.`);

            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: `💳 Pay ${amount} USDC`, callback_data: `pay_${amount}` }]]
                }
            };
            bot?.sendMessage(Number(clientChatId), `The attorney has reviewed your inquiry. The established fee is **${amount} USDC**. Please settle the payment to proceed:`, options);
            store.addActivity("payment", `CEO set price: ${amount} USDC for client`);
            return;
        }

        // --- CONTEXT 2: CEO SETTING PRE-APPROVED RULE (e.g., /preset contract 50) ---
        if (text.startsWith("/preset ")) {
            const parts = text.split(" ");
            if (parts.length >= 3) {
                const keyword = parts[1].toLowerCase();
                const amount = Number(parts[2]);
                preApprovedInvoices.set(keyword, amount);
                bot?.sendMessage(Number(chatId), `✅ **Auto-Rule Saved:** If a client mentions "${keyword}", I will charge ${amount} USDC automatically.`);
                return;
            }
        }

        // --- CONTEXT 3: GENERAL CEO INTERACTION ---
        store.addActivity("telegram", `CEO Log: ${text}`);
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💰 Generate Custom Invoice", callback_data: `manual_bill` }],
                    [{ text: "🗑️ Dismiss Action", callback_data: `ignore` }]
                ]
            }
        };
        bot?.sendMessage(Number(chatId), `💼 **Citadelle Node Online.**\n\nI have logged your request. Should I prepare an invoice or stay on standby for incoming inquiries?`, options);

      } else {
        // --- CONTEXT 4: CLIENT / THIRD PARTY INTERACTION ---

        // Check for Auto-Rules
        let matchedKeyword = null;
        for (const keyword of preApprovedInvoices.keys()) {
            if (text.toLowerCase().includes(keyword)) {
                matchedKeyword = keyword;
                break;
            }
        }

        if (matchedKeyword) {
            const amount = preApprovedInvoices.get(matchedKeyword);
            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: `💳 Pay ${amount} USDC`, callback_data: `pay_${amount}` }]]
                }
            };
            bot?.sendMessage(Number(chatId), `Hello. Based on your request regarding **${matchedKeyword}**, the professional fee is ${amount} USDC. Please proceed with the secure payment:`, options);
            store.addActivity("telegram", `Auto-replied to client for ${matchedKeyword}`);
            return;
        }

        // Default: Notify CEO for Manual Quote
        bot?.sendMessage(Number(chatId), "Understood. I have notified the attorney to provide a quote for your inquiry. Please remain on standby.");

        if (ceoChatId) {
            clientsWaitingForPrice.set(ceoChatId, chatId);
            bot?.sendMessage(Number(ceoChatId), `🔔 **New Client Inquiry** (@${msg.from?.username || "Client"})\n\n"_${text}_"\n\nHow much should I charge? (Reply with a number only)`);
        }
      }
    });

    bot.on("callback_query", (query) => {
        const chatId = query.message?.chat.id.toString();
        const data = query.data;
        const isCEO = ceoChatId && String(chatId) === String(ceoChatId);

        if (!chatId || !data) return;

        // CEO BUTTON ACTIONS
        if (isCEO) {
            if (data === "ignore") {
                bot?.answerCallbackQuery(query.id);
                bot?.sendMessage(Number(chatId), "Action dismissed. System on standby.");
            }
            if (data === "manual_bill") {
                bot?.answerCallbackQuery(query.id);
                bot?.sendMessage(Number(chatId), "Locus payment gateway integration pending in the next phase.");
            }
        }

        // CLIENT PAYMENT BUTTONS
        if (data.startsWith("pay_")) {
            const amount = data.replace("pay_", "");
            bot?.answerCallbackQuery(query.id);
            bot?.sendMessage(Number(chatId), `🔗 Redirecting to Locus Secure Checkout for **${amount} USDC**... (Bridge pending)`);
            store.addActivity("payment", `Client initiated 10 USDC payment protocol`);

            if (ceoChatId) {
                bot?.sendMessage(Number(ceoChatId), `💰 Client is attempting to process payment for **${amount} USDC**.`);
            }
        }
    });

    bot.on("polling_error", (err) => {
      if ((err as any)?.response?.statusCode === 409) {
        console.log("[Telegram] 409 Conflict - stopping polling.");
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

export async function sendMessage(message: string, chatId?: string, options?: any): Promise<boolean> {
  if (!bot) return false;
  const targetChat = chatId || process.env.TELEGRAM_CHAT_ID;
  if (!targetChat) return false;

  try {
    await bot.sendMessage(Number(targetChat), message, options || { parse_mode: "Markdown" });
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