import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import { initTelegramBot } from "./lib/telegram";
import { startTransferMonitor } from "./lib/crypto";
import { store } from "./lib/store";

const app: Express = express();

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);

initTelegramBot();
startTransferMonitor();
store.addActivity("system", "Venice AI Legal Platform started");

export default app;
