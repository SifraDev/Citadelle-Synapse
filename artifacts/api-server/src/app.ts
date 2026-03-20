import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { initTelegramBot } from "./lib/telegram";
import { startTransferMonitor } from "./lib/crypto";
import { locusHealthCheck, startLocusMonitor, isLocusConfigured } from "./lib/locus";
import { isUniswapConfigured, getSwapConfig } from "./lib/uniswap";
import { store } from "./lib/store";

const app: Express = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

initTelegramBot();
startTransferMonitor();

if (isLocusConfigured()) {
  locusHealthCheck().then((health) => {
    if (health.connected) {
      store.addActivity(
        "system",
        `Locus treasury connected: ${health.balance} USDC | Wallet: ${health.walletAddress} | Allowance: ${health.allowance} USDC`
      );
    } else {
      store.addActivity("system", "Locus: configured but failed to connect");
    }
  });
  startLocusMonitor();
} else {
  store.addActivity("system", "Locus: not configured (LOCUS_API_KEY missing)");
}

if (isUniswapConfigured()) {
  const swapConfig = getSwapConfig();
  store.addActivity(
    "system",
    `Uniswap Trading API ready — auto-swap ${(swapConfig.commissionRate * 100).toFixed(0)}% commission USDC→ETH (min ${swapConfig.minSwapThreshold} USDC)`
  );
  console.log("[Uniswap] Trading API configured and ready");
  if (process.env.OWNER_ADDRESS) {
    console.log(`[Delegation] Owner binding active: ${process.env.OWNER_ADDRESS}`);
  } else {
    console.warn("[Delegation] WARNING: OWNER_ADDRESS not set — delegation subsystem disabled, autonomous swaps will be rejected");
    store.addActivity("system", "Delegation subsystem disabled — set OWNER_ADDRESS to enable autonomous swaps");
  }
} else {
  store.addActivity("system", "Uniswap: not configured (UNISWAP_API_KEY or PRIVATE_KEY missing)");
}

store.addActivity("system", "Venice AI Legal Platform started");

export default app;
