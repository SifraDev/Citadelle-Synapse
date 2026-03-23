import TelegramBot from "node-telegram-bot-api";
import { store } from "./store.js";
import { getAgentWallet, getEthBalance, getVvvBalance } from "./crypto.js";
import { isLocusConfigured, getLocusBalance, getLocusWalletAddress } from "./locus.js";
import { isUniswapConfigured, performAutonomousSwap } from "./uniswap.js";
import { getDelegationStatus } from "./delegation.js";
import { getIdentityStatus, checkRegistration, registerAgent } from "./erc8004.js";
import { trackCall, canCall } from "./budget.js";

function getPaymentUrl(chargeId: string): string {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS || "";
  if (domain) {
    return `https://${domain}/pay/${chargeId}`;
  }
  return `/pay/${chargeId}`;
}

export let bot: TelegramBot | null = null;
let botInfo: { username: string } | null = null;
export let isInitialized = false;

interface PendingInquiry {
  clientChatId: string;
  clientName: string;
  message: string;
  timestamp: number;
}

const pendingClientInquiries: PendingInquiry[] = [];
const clientsAlreadyWaiting = new Set<string>();
const preApprovedInvoices = new Map<string, number>();
const INQUIRY_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function cleanExpiredInquiries(ceoChatId?: string): void {
  let i = 0;
  while (i < pendingClientInquiries.length) {
    const entry = pendingClientInquiries[i];
    if (Date.now() - entry.timestamp > INQUIRY_TIMEOUT_MS) {
      pendingClientInquiries.splice(i, 1);
      clientsAlreadyWaiting.delete(entry.clientChatId);
      if (ceoChatId) {
        budgetedSend(ceoChatId, `⏰ Inquiry from <b>${entry.clientName}</b> expired after 24h without a response and was removed from the queue.`);
      }
      budgetedSend(entry.clientChatId, `We apologize — your inquiry was not processed in time. Please reach out again and we will prioritize your request.`);
    } else {
      i++;
    }
  }
}

function peekNextInquiry(ceoChatId?: string): PendingInquiry | undefined {
  cleanExpiredInquiries(ceoChatId);
  return pendingClientInquiries.length > 0 ? pendingClientInquiries[0] : undefined;
}

function popNextInquiry(ceoChatId?: string): PendingInquiry | undefined {
  cleanExpiredInquiries(ceoChatId);
  if (pendingClientInquiries.length > 0) {
    const oldest = pendingClientInquiries.shift()!;
    clientsAlreadyWaiting.delete(oldest.clientChatId);
    return oldest;
  }
  return undefined;
}

function getQueueSummary(ceoChatId?: string): string {
  cleanExpiredInquiries(ceoChatId);
  if (pendingClientInquiries.length === 0) return "No pending client inquiries.";
  return pendingClientInquiries.map((i, idx) => `${idx + 1}. ${i.clientName} — "${i.message.substring(0, 60)}${i.message.length > 60 ? "..." : ""}"`).join("\n");
}

function logOutgoing(recipient: string, text: string) {
  const label = recipient === process.env.TELEGRAM_CHAT_ID ? "Managing Partner" : `Client ${recipient}`;
  store.addActivity("telegram", `Citadelle replied to ${label}: ${text.substring(0, 200)}${text.length > 200 ? "..." : ""}`);
}

function budgetedSend(chatId: string, text: string, options?: object): void {
  if (!bot) return;
  if (!canCall("telegram")) {
    console.warn("[Telegram] Budget exhausted, skipping bot reply");
    return;
  }
  trackCall("telegram");
  bot.sendMessage(Number(chatId), text, options || { parse_mode: "HTML" }).catch((err) => {
    console.error("[Telegram] Send error:", err.message);
  });
  logOutgoing(chatId, text);
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
      console.log(`[Telegram] Citadelle connected as @${botInfo.username}`);
      store.addActivity("telegram", `Citadelle Legal Assistant connected as @${botInfo.username}`);
    }).catch((err) => {
      console.error("[Telegram] Failed to get bot info:", err.message);
    });

    bot.on("message", async (msg) => {
      const chatId = msg.chat.id.toString();
      const text = msg.text?.trim() || "";
      const isCEO = ceoChatId && String(chatId) === String(ceoChatId);

      if (!text) return;

      store.addActivity("telegram", `Incoming from ${isCEO ? "Managing Partner" : `Client @${msg.from?.username || "Unknown"}`}: ${text.substring(0, 200)}`);

      if (isCEO) {
        if (text === "/balance") {
          let balanceMsg = "📊 <b>Firm Treasury & Compute Report</b>\n\n";
          if (isLocusConfigured()) {
            const locusInfo = await getLocusBalance();
            if (locusInfo) {
              balanceMsg += `<b>Locus Escrow (Client Funds)</b>\nAddress: <code>${locusInfo.wallet_address}</code>\nBalance: ${locusInfo.usdc_balance} USDC\nAllowance: ${locusInfo.allowance} USDC\nChain: ${locusInfo.chain}\n\n`;
            } else {
              balanceMsg += "Locus: ❌ Sync Failed\n\n";
            }
          }
          const vvvBal = await getVvvBalance();
          const ethBal = await getEthBalance();
          balanceMsg += `<b>Citadelle Execution Wallet</b>\nAddress: <code>${getAgentWallet()}</code>\nNetwork: Base\n\n`;
          balanceMsg += `<b>Gas Reserves:</b> ${parseFloat(ethBal).toFixed(6)} ETH\n`;
          balanceMsg += `<b>Venice Compute Equity:</b> ${parseFloat(vvvBal).toFixed(4)} VVV`;
          budgetedSend(chatId, balanceMsg);
          return;
        }

        if (text.startsWith("/charge ")) {
            const parts = text.substring(8).trim().split(/\s+/);
            const amount = Number(parts[0]);
            const label = parts.slice(1).join(" ") || undefined;
            if (isNaN(amount) || amount <= 0) {
              budgetedSend(chatId, "Usage: /charge <amount> [client name]\nExample: /charge 500 Acme Corp");
              return;
            }
            const charge = store.addCharge(String(amount), label);

            const locusWallet = await getLocusWalletAddress();
            if (locusWallet) {
              store.updateCharge(charge.id, { locusWalletAddress: locusWallet });
            }

          const payUrl = "https://citadelle-synapse.replit.app/pay/" + charge.id;
            const walletDisplay = locusWallet || getAgentWallet();
            budgetedSend(chatId, `🧾 <b>Retainer Created:</b> ${amount} USDC${label ? ` for ${label}` : ""}\n\nSecure Portal: ${payUrl}\nEscrow: <code>${walletDisplay}</code>${locusWallet ? "\n🛡️ Secured by Locus" : ""}\n\nYou may forward this link to the client for immediate settlement.`);
            return;
        }

        if (text === "/skip") {
            const skipped = popNextInquiry(chatId);
            if (skipped) {
              budgetedSend(chatId, `⏭️ Skipped inquiry from ${skipped.clientName}. ${pendingClientInquiries.length} remaining in queue.`);
              budgetedSend(skipped.clientChatId, "The managing partner has reviewed your inquiry and will follow up at a later time. No action is needed from you right now.");
              const next = peekNextInquiry(chatId);
              if (next) {
                budgetedSend(chatId, `📋 Next in queue: <b>${next.clientName}</b>\n"<i>${next.message.substring(0, 200)}</i>"\n\nReply with a number (USDC) to set the retainer, or /skip to dismiss.`);
              }
            } else {
              budgetedSend(chatId, "No pending client inquiries to skip.");
            }
            return;
        }

        if (text === "/queue") {
            const summary = getQueueSummary(chatId);
            budgetedSend(chatId, `📋 <b>Client Inquiry Queue</b>\n\n${summary}`);
            return;
        }

        if (pendingClientInquiries.length > 0 && !isNaN(Number(text)) && Number(text) > 0) {
            const inquiry = popNextInquiry(chatId);
            if (!inquiry) {
              budgetedSend(chatId, "No valid pending inquiries to price. The queue may have expired.");
              return;
            }
            const amount = Number(text);

            const charge = store.addCharge(String(amount), `client-intake-${inquiry.clientName}`);
            const locusWallet = await getLocusWalletAddress();
            if (locusWallet) {
              store.updateCharge(charge.id, { locusWalletAddress: locusWallet });
            }
            const payUrl = getPaymentUrl(charge.id);
            const walletDisplay = locusWallet || getAgentWallet();

            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: `💳 Fund Retainer (${amount} USDC)`, url: payUrl }]]
                }
            };
            budgetedSend(inquiry.clientChatId, `The managing partner has reviewed your file. The required retainer to proceed is <b>${amount} USDC</b>.\n\nPlease fund the secure escrow via the portal below:\n${payUrl}\n\nOr send ${amount} USDC directly to the firm's vault:\nWallet: <code>${walletDisplay}</code>\nNetwork: Base`, options);
            store.addActivity("payment", `Partner set retainer: ${amount} USDC for ${inquiry.clientName}`);

            const remaining = pendingClientInquiries.length;
            budgetedSend(chatId, `✅ Payment link sent to <b>${inquiry.clientName}</b> for <b>${amount} USDC</b>. Awaiting payment.${remaining > 0 ? `\n\n📋 ${remaining} more inquiry${remaining > 1 ? "ies" : "y"} waiting.` : ""}`);

            if (remaining > 0) {
              const next = peekNextInquiry(chatId);
              if (next) {
                budgetedSend(chatId, `Next: <b>${next.clientName}</b>\n"<i>${next.message.substring(0, 200)}</i>"\n\nReply with a number (USDC) or /skip.`);
              }
            }
            return;
        }

        if (text.startsWith("/preset ")) {
            const parts = text.split(" ");
            if (parts.length >= 3) {
                const keyword = parts[1].toLowerCase();
                const amount = Number(parts[2]);
                preApprovedInvoices.set(keyword, amount);
                budgetedSend(chatId, `✅ Rule Saved: I will automatically quote ${amount} USDC to any client inquiring about "${keyword}".`);
                return;
            }
        }

        if (text === "/gas") {
          const ethBal = await getEthBalance();
          const delegationInfo = getDelegationStatus();
          const walletAddr = getAgentWallet();
          let gasMsg = `⛽ <b>Infrastructure & Gas Status</b>\n\nETH Reserves: ${parseFloat(ethBal).toFixed(6)} ETH\nAgent Wallet: <a href="https://basescan.org/address/${walletAddr}">${walletAddr}</a>\nNetwork: Base`;
          if (delegationInfo.active) {
            gasMsg += `\n\n🔑 Partner Delegation: Active\nDaily Utilization: ${delegationInfo.dailyUsedUsdc?.toFixed(2)}/${delegationInfo.dailyLimitUsdc} USDC`;
          } else {
            gasMsg += `\n\n🔒 Partner Delegation: ${delegationInfo.reason || "None"}`;
          }
          budgetedSend(chatId, gasMsg);
          return;
        }

        if (text === "/identity" || text.startsWith("/identity ")) {
          const subCmd = text.substring(10).trim();
          if (subCmd === "register") {
            budgetedSend(chatId, "⏳ Submitting firm's agent entity to Base mainnet registry...");
            const regResult = await registerAgent();
            if (regResult.success) {
              budgetedSend(chatId, `🏛️ <b>Entity Registration Complete</b>\n\nAgent ID: ${regResult.agentId}\nTx: <a href="https://basescan.org/tx/${regResult.txHash}">${regResult.txHash?.slice(0, 16)}...</a>\nRegistry: <code>0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</code>`);
            } else {
              budgetedSend(chatId, `❌ Registry submission failed: ${regResult.error}`);
            }
          } else {
            const identity = await checkRegistration();
            let idMsg = `🏛️ <b>ERC-8004 Legal Entity Status</b>\n\n`;
            idMsg += `Status: ${identity.registered ? "✅ Officially Registered" : "❌ Unregistered Entity"}\n`;
            if (identity.agentId !== undefined) {
              idMsg += `License/Agent ID: #${identity.agentId}\n`;
            }
            idMsg += `Execution Wallet: <code>${identity.walletAddress}</code>\n`;
            if (identity.reputationScore !== undefined) {
              idMsg += `\n📊 <b>Firm Reputation Score:</b> ${identity.reputationScore}`;
            }
            if (!identity.registered) {
              idMsg += `\n\nUse /identity register to formalize our entity on-chain.`;
            }
            budgetedSend(chatId, idMsg);
          }
          return;
        }

        if (text.startsWith("/swap ")) {
          const swapAmount = Number(text.substring(6).trim());
          if (isNaN(swapAmount) || swapAmount <= 0) {
            budgetedSend(chatId, "Usage: /swap <amount_usdc>\nExample: /swap 5");
            return;
          }
          if (!isUniswapConfigured()) {
            budgetedSend(chatId, "❌ Uniswap integration missing (API Key or Private Key required).");
            return;
          }
          budgetedSend(chatId, `⏳ Executing firm treasury swap: ${swapAmount} USDC → ETH via Uniswap...`);
          const swapResult = await performAutonomousSwap(swapAmount);
          if (swapResult.success) {
            budgetedSend(chatId, `✅ Trade Executed Successfully!\n\nDeployed: ${swapResult.amountIn} USDC\nAcquired: ~${parseFloat(swapResult.amountOut || "0").toFixed(6)} ETH\nTx: <a href="https://basescan.org/tx/${swapResult.txHash}">${swapResult.txHash?.slice(0, 16)}...</a>`);
          } else if (swapResult.delegationDenied) {
            budgetedSend(chatId, `🔒 Operations Blocked — ${swapResult.reason}\n\nPlease authorize the delegation from the web dashboard.`);
          } else {
            budgetedSend(chatId, `❌ Trade failed: ${swapResult.error}`);
          }
          return;
        }

        // ==========================================
        // SMART CONVERSATIONAL HANDLING FOR CEO
        // ==========================================
        const lowerText = text.toLowerCase().trim();
        const greetings = ["hi", "hello", "hey", "hola", "buenos dias", "buenas tardes", "buenas noches", "good morning", "good evening"];

        if (greetings.includes(lowerText)) {
            budgetedSend(chatId, "Good day. Citadelle is fully synced and monitoring the Base network. How can I assist the firm today?");
            return;
        }

        store.addActivity("telegram", `Partner Memo: ${text}`);
        const options = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🧾 Prepare Client Invoice", callback_data: `manual_bill` }],
                    [{ text: "📝 Just a Memo (Dismiss)", callback_data: `ignore` }]
                ]
            }
        };
        budgetedSend(chatId, `Message securely logged in the firm's records.\n\nShall I prepare a payment portal for a client, or is this just an internal memo?`, options);

      } else {
        const clientName = msg.from?.first_name || msg.from?.username || `Client-${chatId.slice(-4)}`;

        cleanExpiredInquiries(ceoChatId || undefined);

        if (clientsAlreadyWaiting.has(chatId)) {
          budgetedSend(chatId, `Thank you, ${clientName}. Your inquiry is currently being reviewed by the managing partner. You will be notified as soon as a decision is made.`);
          return;
        }

        let matchedKeyword = null;
        for (const [keyword, amount] of preApprovedInvoices.entries()) {
            if (text.toLowerCase().includes(keyword)) {
                matchedKeyword = keyword;
                break;
            }
        }

        if (matchedKeyword) {
            const amount = preApprovedInvoices.get(matchedKeyword)!;
            const charge = store.addCharge(String(amount), `auto-${matchedKeyword}-${clientName}`);
            const locusWallet = await getLocusWalletAddress();
            if (locusWallet) {
              store.updateCharge(charge.id, { locusWalletAddress: locusWallet });
            }
            const payUrl = getPaymentUrl(charge.id);
            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: `💳 Fund Retainer (${amount} USDC)`, url: payUrl }]]
                }
            };
            budgetedSend(chatId, `Hello, ${clientName}. Regarding your inquiry about "${matchedKeyword}", the firm's standard retainer is <b>${amount} USDC</b>.\n\nYou may secure our services immediately via the portal below:`, options);
            store.addActivity("telegram", `Auto-quoted ${clientName} for ${matchedKeyword}`);
            return;
        }

        budgetedSend(chatId, `Thank you for reaching out, ${clientName}. I am Citadelle, the autonomous intake agent for the firm. Your inquiry has been securely forwarded to the managing partner for review. You will receive a response shortly.`);

        if (ceoChatId) {
            pendingClientInquiries.push({
              clientChatId: chatId,
              clientName,
              message: text,
              timestamp: Date.now(),
            });
            clientsAlreadyWaiting.add(chatId);
            const queuePos = pendingClientInquiries.length;
            budgetedSend(ceoChatId, `🔔 <b>New Client Intake</b> from <b>${clientName}</b> (@${msg.from?.username || "N/A"})${queuePos > 1 ? ` [Queue position: #${queuePos}]` : ""}\n\n"<i>${text}</i>"\n\nReply with a number (USDC) to set the retainer, or /skip to dismiss.`);
        }
      }
    });

    bot.on("callback_query", async (query) => {
        const chatId = query.message?.chat.id.toString();
        const data = query.data;
        const isCEO = ceoChatId && String(chatId) === String(ceoChatId);

        if (!chatId || !data) return;

        if (isCEO) {
            if (data === "ignore") {
                bot?.answerCallbackQuery(query.id);
                budgetedSend(chatId, "Noted. System standing by.");
            }
            if (data === "manual_bill") {
                bot?.answerCallbackQuery(query.id);
                const next = peekNextInquiry(chatId);
                if (next) {
                  budgetedSend(chatId, `Please enter the retainer amount in USDC for <b>${next.clientName}</b>.\n"<i>${next.message.substring(0, 100)}</i>"\n\nReply with a number, or /skip to dismiss.`);
                } else {
                  budgetedSend(chatId, "No pending client inquiries. Use /charge <amount> [label] to create a standalone invoice.");
                }
            }
        }

        if (data.startsWith("charge_")) {
            const chargeId = data.replace("charge_", "");
            const charge = store.getCharge(chargeId);
            bot?.answerCallbackQuery(query.id);
            if (charge) {
                const walletAddr = charge.locusWalletAddress || getAgentWallet();
                const isLocus = !!charge.locusWalletAddress;
                budgetedSend(chatId, `💳 <b>Payment Details:</b>\n\nAmount: ${charge.amount} USDC\nWallet: <code>${walletAddr}</code>\nNetwork: Base (Chain ID 8453)\nToken: USDC${isLocus ? "\n🛡️ Secured by Locus" : ""}\n\nPlease remit exactly ${charge.amount} USDC to the wallet above.`);
            } else {
                budgetedSend(chatId, "This invoice is no longer active or has expired.");
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

  if (!canCall("telegram")) {
    console.warn("[Telegram] Budget exhausted, skipping message send");
    return false;
  }
  trackCall("telegram");
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
