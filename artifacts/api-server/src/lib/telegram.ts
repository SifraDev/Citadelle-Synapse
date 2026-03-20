import TelegramBot from "node-telegram-bot-api";
import { store } from "./store.js";
import { getAgentWallet, getEthBalance } from "./crypto.js";
import { isLocusConfigured, getLocusBalance, getLocusWalletAddress } from "./locus.js";
import { isUniswapConfigured, performAutonomousSwap } from "./uniswap.js";
import { getDelegationStatus } from "./delegation.js";
import { getIdentityStatus, checkRegistration, registerAgent } from "./erc8004.js";

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

    bot.on("message", async (msg) => {
      const chatId = msg.chat.id.toString();
      const text = msg.text?.trim() || "";
      const isCEO = ceoChatId && String(chatId) === String(ceoChatId);

      if (!text) return;

      store.addActivity("telegram", `Incoming from ${isCEO ? "CEO" : `@${msg.from?.username || "client"}`}: ${text.substring(0, 200)}`);

      if (isCEO) {
        if (text === "/balance") {
          let balanceMsg = "💰 <b>Treasury Status</b>\n\n";
          if (isLocusConfigured()) {
            const locusInfo = await getLocusBalance();
            if (locusInfo) {
              balanceMsg += `<b>Locus Wallet</b>\nAddress: <code>${locusInfo.wallet_address}</code>\nBalance: ${locusInfo.usdc_balance} USDC\nAllowance: ${locusInfo.allowance} USDC\nChain: ${locusInfo.chain}\n\n`;
            } else {
              balanceMsg += "Locus: ❌ Failed to fetch\n\n";
            }
          }
          balanceMsg += `<b>Direct Wallet</b>\nAddress: <code>${getAgentWallet()}</code>\nNetwork: Base`;
          bot?.sendMessage(Number(chatId), balanceMsg, { parse_mode: "HTML" });
          logOutgoing(chatId, balanceMsg);
          return;
        }

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

            const locusWallet = await getLocusWalletAddress();
            if (locusWallet) {
              store.updateCharge(charge.id, { locusWalletAddress: locusWallet });
            }

            const payUrl = getPaymentUrl(charge.id);
            const walletDisplay = locusWallet || getAgentWallet();
            const chargeMsg = `💳 Charge created: ${amount} USDC${label ? ` for ${label}` : ""}\n\nPayment Link: ${payUrl}\nWallet: <code>${walletDisplay}</code>${locusWallet ? "\n💎 Powered by Locus" : ""}\n\nShare this link with the client to pay via MetaMask.`;
            bot?.sendMessage(Number(chatId), chargeMsg, { parse_mode: "HTML" });
            logOutgoing(chatId, chargeMsg);
            return;
        }

        if (clientsWaitingForPrice.has(chatId) && !isNaN(Number(text))) {
            const clientChatId = clientsWaitingForPrice.get(chatId)!;
            const amount = Number(text);
            clientsWaitingForPrice.delete(chatId);

            const charge = store.addCharge(String(amount), `telegram-client-${clientChatId}`);
            const locusWallet = await getLocusWalletAddress();
            if (locusWallet) {
              store.updateCharge(charge.id, { locusWalletAddress: locusWallet });
            }
            const payUrl = getPaymentUrl(charge.id);
            const walletDisplay = locusWallet || getAgentWallet();

            const confirmMsg = `✅ Confirmed. Charge created for ${amount} USDC.${locusWallet ? " 💎 Locus" : ""}\nPayment Link: ${payUrl}`;
            bot?.sendMessage(Number(chatId), confirmMsg);
            logOutgoing(chatId, confirmMsg);

            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: `💳 Pay ${amount} USDC`, url: payUrl }]]
                }
            };
            const invoiceMsg = `The attorney has reviewed your inquiry. The established fee is **${amount} USDC**.\n\nPay here: ${payUrl}\n\nOr send ${amount} USDC directly to:\nWallet: \`${walletDisplay}\`\nNetwork: Base`;
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

        if (text === "/gas") {
          const ethBal = await getEthBalance();
          const delegationInfo = getDelegationStatus();
          const walletAddr = getAgentWallet();
          let gasMsg = `⛽ <b>Gas Treasury</b>\n\nETH Balance: ${parseFloat(ethBal).toFixed(6)} ETH\nWallet: <a href="https://basescan.org/address/${walletAddr}">${walletAddr}</a>\nNetwork: Base`;
          if (delegationInfo.active) {
            gasMsg += `\n\n🔑 Delegation: Active\nDaily: ${delegationInfo.dailyUsedUsdc?.toFixed(2)}/${delegationInfo.dailyLimitUsdc} USDC`;
          } else {
            gasMsg += `\n\n🔒 Delegation: ${delegationInfo.reason || "None"}`;
          }
          bot?.sendMessage(Number(chatId), gasMsg, { parse_mode: "HTML" });
          logOutgoing(chatId, gasMsg);
          return;
        }

        if (text === "/identity" || text.startsWith("/identity ")) {
          const subCmd = text.substring(10).trim();
          if (subCmd === "register") {
            bot?.sendMessage(Number(chatId), "⏳ Registering agent identity on Base mainnet...");
            const regResult = await registerAgent();
            if (regResult.success) {
              const idMsg = `🆔 <b>Agent Registered</b>\n\nAgent ID: ${regResult.agentId}\nTx: <a href="https://basescan.org/tx/${regResult.txHash}">${regResult.txHash?.slice(0, 16)}...</a>\nRegistry: <code>0x8004A169FB4a3325136EB29fA0ceB6D2e539a432</code>`;
              bot?.sendMessage(Number(chatId), idMsg, { parse_mode: "HTML" });
            } else {
              bot?.sendMessage(Number(chatId), `❌ Registration failed: ${regResult.error}`);
            }
          } else {
            const identity = await checkRegistration();
            let idMsg = `🆔 <b>ERC-8004 Agent Identity</b>\n\n`;
            idMsg += `Status: ${identity.registered ? "✅ Registered" : "❌ Not registered"}\n`;
            if (identity.agentId !== undefined) {
              idMsg += `Agent ID: #${identity.agentId}\n`;
            }
            idMsg += `Wallet: <code>${identity.walletAddress}</code>\n`;
            idMsg += `Registry: <a href="https://basescan.org/address/${identity.registryAddress}">${identity.registryAddress.slice(0, 16)}...</a>\n`;
            idMsg += `Reputation: <a href="https://basescan.org/address/${identity.reputationRegistryAddress}">${identity.reputationRegistryAddress.slice(0, 16)}...</a>\n`;
            if (identity.reputationScore !== undefined) {
              idMsg += `\n📊 <b>Reputation Score:</b> ${identity.reputationScore}`;
              if (identity.feedbackCount !== undefined) {
                idMsg += ` (${identity.feedbackCount} feedback${identity.feedbackCount !== 1 ? "s" : ""})`;
              }
            }
            if (identity.registrationTxHash) {
              idMsg += `\nTx: <a href="https://basescan.org/tx/${identity.registrationTxHash}">${identity.registrationTxHash.slice(0, 16)}...</a>`;
            }
            if (!identity.registered) {
              idMsg += `\n\nUse /identity register to register on-chain.`;
            }
            bot?.sendMessage(Number(chatId), idMsg, { parse_mode: "HTML" });
          }
          return;
        }

        if (text.startsWith("/swap ")) {
          const swapAmount = Number(text.substring(6).trim());
          if (isNaN(swapAmount) || swapAmount <= 0) {
            bot?.sendMessage(Number(chatId), "Usage: /swap <amount_usdc>\nExample: /swap 5");
            return;
          }
          if (!isUniswapConfigured()) {
            bot?.sendMessage(Number(chatId), "❌ Uniswap not configured (UNISWAP_API_KEY or PRIVATE_KEY missing).");
            return;
          }
          bot?.sendMessage(Number(chatId), `⏳ Swapping ${swapAmount} USDC → ETH via Uniswap...`);
          const swapResult = await performAutonomousSwap(swapAmount);
          if (swapResult.success) {
            const successMsg = `✅ Swap complete!\n\nIn: ${swapResult.amountIn} USDC\nOut: ~${parseFloat(swapResult.amountOut || "0").toFixed(6)} ETH\nTx: <a href="https://basescan.org/tx/${swapResult.txHash}">${swapResult.txHash?.slice(0, 16)}...</a>`;
            bot?.sendMessage(Number(chatId), successMsg, { parse_mode: "HTML" });
          } else if (swapResult.delegationDenied) {
            bot?.sendMessage(Number(chatId), `🔒 Swap blocked — ${swapResult.reason}\n\nPlease sign a delegation in the dashboard.`);
          } else {
            bot?.sendMessage(Number(chatId), `❌ Swap failed: ${swapResult.error}`);
          }
          return;
        }

        if (text.startsWith("/send ")) {
            const parts = text.substring(6).trim().split(/\s+/);
            if (parts.length >= 3) {
              const toAddress = parts[0];
              const sendAmount = Number(parts[1]);
              const memo = parts.slice(2).join(" ");
              if (!toAddress.startsWith("0x") || isNaN(sendAmount) || sendAmount <= 0) {
                bot?.sendMessage(Number(chatId), "Usage: /send <0x_address> <amount> <memo>\nExample: /send 0xABC... 10 Refund for client");
                return;
              }
              if (!isLocusConfigured()) {
                bot?.sendMessage(Number(chatId), "❌ Locus not configured. Cannot send payments.");
                return;
              }
              const { locusSendPayment: sendPayment } = await import("./locus.js");
              const result = await sendPayment(toAddress, sendAmount, memo);
              if ("error" in result) {
                bot?.sendMessage(Number(chatId), `❌ Send failed: ${result.error}`);
              } else {
                const successMsg = `✅ Sent ${sendAmount} USDC to <code>${toAddress}</code>\nTx: <a href="https://basescan.org/tx/${result.tx_hash}">${result.tx_hash.slice(0, 16)}...</a>`;
                bot?.sendMessage(Number(chatId), successMsg, { parse_mode: "HTML" });
              }
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
            const amount = preApprovedInvoices.get(matchedKeyword)!;
            const charge = store.addCharge(String(amount), `auto-${matchedKeyword}-${chatId}`);
            const locusWallet = await getLocusWalletAddress();
            if (locusWallet) {
              store.updateCharge(charge.id, { locusWalletAddress: locusWallet });
            }
            const payUrl = getPaymentUrl(charge.id);
            const options = {
                reply_markup: {
                    inline_keyboard: [[{ text: `💳 Pay ${amount} USDC`, url: payUrl }]]
                }
            };
            const autoMsg = `Hello. Based on your request regarding **${matchedKeyword}**, the professional fee is ${amount} USDC.\n\nPay here: ${payUrl}`;
            bot?.sendMessage(Number(chatId), autoMsg, options);
            logOutgoing(chatId, autoMsg);
            store.addActivity("telegram", `Auto-replied to client for ${matchedKeyword} — charge created`);
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

    bot.on("callback_query", async (query) => {
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
                bot?.sendMessage(
                  Number(chatId),
                  "Enter the invoice amount in USDC (number only).\nI will create a Locus-powered charge and generate a payment link."
                );
                clientsWaitingForPrice.set(chatId, chatId);
            }
        }

        if (data.startsWith("charge_")) {
            const chargeId = data.replace("charge_", "");
            const charge = store.getCharge(chargeId);
            bot?.answerCallbackQuery(query.id);
            if (charge) {
                const walletAddr = charge.locusWalletAddress || getAgentWallet();
                const isLocus = !!charge.locusWalletAddress;
                const payMsg = `💳 Payment Details:\n\nAmount: ${charge.amount} USDC\nWallet: ${walletAddr}\nNetwork: Base (Chain ID 8453)\nToken: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)${isLocus ? "\n💎 Powered by Locus" : ""}\n\nSend exactly ${charge.amount} USDC to the wallet above on Base network.`;
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
