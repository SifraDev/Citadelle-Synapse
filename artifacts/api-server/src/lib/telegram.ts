import TelegramBot from "node-telegram-bot-api";
import { store } from "./store.js";
import { getAgentWallet } from "./crypto.js";

export let bot: TelegramBot | null = null;
let botInfo: { username: string } | null = null;
export let isInitialized = false;

const clientsWaitingForPrice = new Map<string, string>();
const preApprovedInvoices = new Map<string, number>();

function logOutgoing(recipient: string, text: string) {
  const label = recipient === process.env.TELEGRAM_CHAT_ID ? "CEO" : `chat ${recipient}`;
  store.addActivity("telegram", `Bot replied to ${label}: ${text.substring(0, 200)}${text.length > 200 ? "..." : ""}`);
}

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

      store.addActivity("telegram", `Incoming from ${isCEO ? "CEO" : `@${msg.from?.username || "client"}`}: ${text.substring(0, 200)}`);

      if (isCEO) {
        if (text.startsWith("/charge ")) {
            const parts = text.substring(8).trim().split(/\s+/);
            const amount = Number(parts[0]);
            const label = parts.slice(1).join(" ") || undefined;
            if (isNaN(amount) || amount <= 0) {
              const errMsg = "Usage: /charge <amount> [client name]\nExample: /charge 500 Acme Corp";
              bot?.sendMessage(Number(chatId), errMsg);
              logOutgoing(chatId, errMsg);
              return;
            }
            const charge = store.addCharge(String(amount), label);
            const chargeMsg = `💳 Charge created: ${amount} USDC${label ? ` for ${label}` : ""}\n\nCharge ID: ${charge.id}\nWallet: ${getAgentWallet()}\nNetwork: Base\n\nShare the Charge ID with the client to pay via the web platform.`;
            bot?.sendMessage(Number(chatId), chargeMsg);
            logOutgoing(chatId, chargeMsg);
            return;
        }

        if (clientsWaitingForPrice.has(chatId) && !isNaN(Number(text))) {
            const clientChatId = clientsWaitingForPrice.get(chatId)!;
            const amount = Number(text);
            clientsWaitingForPrice.delete(chatId);

            const charge = store.addCharge(String(amount), `telegram-client-${clientChatId}`);

            const confirmMsg = `✅ Confirmed. Charge created for ${amount} USDC.\nCharge ID: ${charge.id}`;
            bot?.sendMessage(Number(chatId), confirmMsg);
            logOutgoing(chatId, confirmMsg);

            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: `💳 Pay ${amount} USDC`, callback_data: `charge_${charge.id}` }]]
                }
            };
            const invoiceMsg = `The attorney has reviewed your inquiry. The established fee is **${amount} USDC**.\n\nWallet: \`${getAgentWallet()}\`\nNetwork: Base (USDC)\n\nPlease proceed with payment:`;
            bot?.sendMessage(Number(clientChatId), invoiceMsg, options);
            logOutgoing(clientChatId, invoiceMsg);
            store.addActivity("payment", `CEO set price: ${amount} USDC for client`);
            return;
        }

        if (text.startsWith("/preset ")) {
            const parts = text.split(" ");
            if (parts.length >= 3) {
                const keyword = parts[1].toLowerCase();
                const amount = Number(parts[2]);
                preApprovedInvoices.set(keyword, amount);
                const ruleMsg = `✅ Auto-Rule Saved: If a client mentions "${keyword}", I will charge ${amount} USDC automatically.`;
                bot?.sendMessage(Number(chatId), ruleMsg);
                logOutgoing(chatId, ruleMsg);
                return;
            }
        }

        store.addActivity("telegram", `CEO Log: ${text}`);
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💰 Generate Custom Invoice", callback_data: `manual_bill` }],
                    [{ text: "🗑️ Dismiss Action", callback_data: `ignore` }]
                ]
            }
        };
        const ackMsg = `💼 Citadelle Node Online.\n\nI have logged your request. Should I prepare an invoice or stay on standby for incoming inquiries?`;
        bot?.sendMessage(Number(chatId), ackMsg, options);
        logOutgoing(chatId, ackMsg);

      } else {
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
            const autoMsg = `Hello. Based on your request regarding **${matchedKeyword}**, the professional fee is ${amount} USDC. Please proceed with the secure payment:`;
            bot?.sendMessage(Number(chatId), autoMsg, options);
            logOutgoing(chatId, autoMsg);
            store.addActivity("telegram", `Auto-replied to client for ${matchedKeyword}`);
            return;
        }

        const holdMsg = "Understood. I have notified the attorney to provide a quote for your inquiry. Please remain on standby.";
        bot?.sendMessage(Number(chatId), holdMsg);
        logOutgoing(chatId, holdMsg);

        if (ceoChatId) {
            clientsWaitingForPrice.set(ceoChatId, chatId);
            const notifyMsg = `🔔 **New Client Inquiry** (@${msg.from?.username || "Client"})\n\n"_${text}_"\n\nHow much should I charge? (Reply with a number only)`;
            bot?.sendMessage(Number(ceoChatId), notifyMsg);
            logOutgoing(ceoChatId, notifyMsg);
        }
      }
    });

    bot.on("callback_query", (query) => {
        const chatId = query.message?.chat.id.toString();
        const data = query.data;
        const isCEO = ceoChatId && String(chatId) === String(ceoChatId);

        if (!chatId || !data) return;

        if (isCEO) {
            if (data === "ignore") {
                bot?.answerCallbackQuery(query.id);
                const msg = "Action dismissed. System on standby.";
                bot?.sendMessage(Number(chatId), msg);
                logOutgoing(chatId, msg);
            }
            if (data === "manual_bill") {
                bot?.answerCallbackQuery(query.id);
                const msg = "Locus payment gateway integration pending in the next phase.";
                bot?.sendMessage(Number(chatId), msg);
                logOutgoing(chatId, msg);
            }
        }

        if (data.startsWith("charge_")) {
            const chargeId = data.replace("charge_", "");
            const charge = store.getCharge(chargeId);
            bot?.answerCallbackQuery(query.id);
            if (charge) {
                const payMsg = `💳 Payment Details:\n\nAmount: ${charge.amount} USDC\nWallet: ${getAgentWallet()}\nNetwork: Base (Chain ID 8453)\nToken: USDC (${store.getCharge(chargeId) ? "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" : ""})\n\nSend exactly ${charge.amount} USDC to the wallet above on Base network. Open the web platform to pay via MetaMask.`;
                bot?.sendMessage(Number(chatId), payMsg);
                logOutgoing(chatId, payMsg);
            } else {
                const errMsg = "Charge not found or expired.";
                bot?.sendMessage(Number(chatId), errMsg);
                logOutgoing(chatId, errMsg);
            }
            if (ceoChatId && chatId !== ceoChatId) {
                const ceoNotify = `💰 Client viewed payment details for charge ${chargeId}.`;
                bot?.sendMessage(Number(ceoChatId), ceoNotify);
                logOutgoing(ceoChatId, ceoNotify);
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
    await bot.sendMessage(Number(targetChat), message, options || { parse_mode: "HTML" });
    logOutgoing(targetChat, message);
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
