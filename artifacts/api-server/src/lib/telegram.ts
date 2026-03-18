import TelegramBot from "node-telegram-bot-api";
import { store } from "./store.js";

export let bot: TelegramBot | null = null;
let botInfo: { username: string } | null = null;
export let isInitialized = false;

const clientsWaitingForPrice = new Map<string, string>();
const preApprovedInvoices = new Map<string, number>();

export function initTelegramBot(): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const ceoChatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) return;
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
    }).catch((err) => console.error("[Telegram] Failed to get bot info:", err.message));

    bot.on("message", (msg) => {
      const chatId = msg.chat.id.toString();
      const text = msg.text?.trim() || "";

      // COMPARACIÓN ESTRICTA PARA SABER SI ES EL JEFE O EL CLIENTE
      const isCEO = ceoChatId && String(chatId) === String(ceoChatId);

        console.log(`[DEBUG] Mensaje recibido de ChatID: ${chatId} | ¿Es CEO?: ${isCEO} | Texto: ${text}`);

      if (!text) return;

      if (isCEO) {
        // --- 1. JEFE FIJANDO PRECIO PARA CLIENTE EN ESPERA ---
        if (clientsWaitingForPrice.has(chatId) && !isNaN(Number(text))) {
            const clientChatId = clientsWaitingForPrice.get(chatId)!;
            const amount = Number(text);
            clientsWaitingForPrice.delete(chatId);

            bot?.sendMessage(Number(chatId), `✅ Precio de ${amount} USDC enviado al cliente.`);

            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: `💳 Pagar ${amount} USDC`, callback_data: `pay_${amount}` }]]
                }
            };
            bot?.sendMessage(Number(clientChatId), `The consultation fee is ${amount} USDC. Please proceed with the payment:`, options);
            store.addActivity("payment", `CEO quoted ${amount} USDC to client`);
            return;
        }

        // --- 2. JEFE CREANDO REGLA AUTOMÁTICA MIENTRAS DUERME ---
        // Ej: /preset india 30
        if (text.startsWith("/preset ")) {
            const parts = text.split(" ");
            if (parts.length >= 3) {
                const keyword = parts[1].toLowerCase();
                const amount = Number(parts[2]);
                preApprovedInvoices.set(keyword, amount);
                bot?.sendMessage(Number(chatId), `✅ Regla guardada: Si un cliente dice "${keyword}", se le cobrará ${amount} USDC automáticamente.`);
                return;
            }
        }

        // --- 3. JEFE ENVIANDO TEXTO GENERAL (EJ. EL REPORTE DE ANTONIO LOPEZ) ---
        store.addActivity("telegram", `Message from CEO: ${text}`);

        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💰 Crear Link de Cobro", callback_data: `bill_custom` }],
                    [{ text: "🗑️ Ignorar", callback_data: `ignore` }]
                ]
            }
        };
        bot?.sendMessage(Number(chatId), `💼 **Recibido, Jefe.**\n\n¿Qué acción desea tomar con este mensaje?`, options);

      } else {
        // ==========================================
        //         TERCEROS / CLIENTES
        // ==========================================

        // --- 1. REVISAR SI APLICA REGLA AUTOMÁTICA DEL JEFE ---
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
                    inline_keyboard: [[{ text: `💳 Pagar ${amount} USDC`, callback_data: `pay_${amount}` }]]
                }
            };
            bot?.sendMessage(Number(chatId), `Hello. The fee for the ${matchedKeyword} matter is ${amount} USDC. Please complete the payment:`, options);
            store.addActivity("telegram", `Auto-replied to client for ${matchedKeyword}`);
            return;
        }

        // --- 2. CLIENTE NUEVO PREGUNTANDO -> AVISAR AL JEFE ---
        bot?.sendMessage(Number(chatId), "Hello. I am the Citadelle Assistant. Let me check the consultation fee with the lead attorney. Please hold.");

        if (ceoChatId) {
            clientsWaitingForPrice.set(ceoChatId, chatId);
            bot?.sendMessage(Number(ceoChatId), `🔔 **Consulta de Cliente** (@${msg.from?.username || "Desconocido"})\n\nMensaje: "${text}"\n\n💬 ¿Cuántos USDC le cobramos? (Responda solo con un número, ej: 30)`);
        }
      }
    });

    bot.on("callback_query", (query) => {
        const chatId = query.message?.chat.id.toString();
        const data = query.data;
        const isCEO = ceoChatId && String(chatId) === String(ceoChatId);

        if (!chatId || !data) return;

        // BOTONES DEL JEFE
        if (isCEO) {
            if (data === "ignore") {
                bot?.answerCallbackQuery(query.id);
                bot?.sendMessage(Number(chatId), "Entendido. Mensaje archivado.");
            }
            if (data === "bill_custom") {
                bot?.answerCallbackQuery(query.id);
                bot?.sendMessage(Number(chatId), "Esta función conectará con Locus próximamente.");
            }
        }

        // BOTONES DEL CLIENTE
        if (data.startsWith("pay_")) {
            const amount = data.replace("pay_", "");
            bot?.answerCallbackQuery(query.id);
            bot?.sendMessage(Number(chatId), `🔗 Processing ${amount} USDC via Locus Protocol... (Integration pending)`);
            store.addActivity("payment", `Client initiated payment of ${amount} USDC`);

            if (ceoChatId) {
                bot?.sendMessage(Number(ceoChatId), `💰 El cliente está procesando el pago de ${amount} USDC.`);
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