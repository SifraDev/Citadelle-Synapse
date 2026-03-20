import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { initTelegramBot } from "./lib/telegram";
import { startTransferMonitor } from "./lib/crypto";
import { locusHealthCheck, startLocusMonitor, isLocusConfigured } from "./lib/locus";
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

store.addActivity("system", "Venice AI Legal Platform started");

export default app;
