import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { createRequire } from "module";
import { streamAnalysis } from "../lib/venice.js";
import { store } from "../lib/store.js";
import { sendMessage } from "../lib/telegram.js";
import { x402Middleware, getX402PricingInfo, type X402PaymentContext } from "../lib/x402.js";
import { recordActionReceipt } from "../lib/erc8004.js";
import { getVeniceDiemCost } from "../lib/budget.js";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

const router: IRouter = Router();

router.get("/x402/info", (_req, res): void => {
  res.json(getX402PricingInfo());
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are accepted"));
    }
  },
});

async function handleAnalysis(req: Request, res: Response): Promise<void> {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No PDF files provided" });
    return;
  }

  const mode = (req.body?.mode as string) || "summarize";
  const customQuery = req.body?.customQuery as string | undefined;
  const validModes = ["summarize", "extract_clauses", "flag_risks", "custom"];
  if (!validModes.includes(mode)) {
    res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(", ")}` });
    return;
  }

  store.addActivity("upload", `${files.length} PDF(s) uploaded for analysis`, {
    fileNames: files.map((f) => f.originalname),
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
  });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendSSE = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const x402Payment: X402PaymentContext | undefined = (req as Request & { _x402Payment?: X402PaymentContext })._x402Payment;

  try {
    sendSSE("status", { phase: "extracting", message: "Extracting text from PDFs..." });

    const documentTexts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      sendSSE("status", {
        phase: "extracting",
        message: `Processing ${file.originalname} (${i + 1}/${files.length})...`,
      });

      try {
        const parsed = await pdfParse(file.buffer);
        documentTexts.push(parsed.text);
        sendSSE("status", {
          phase: "extracted",
          message: `Extracted ${parsed.numpages} pages from ${file.originalname}`,
        });
      } catch {
        sendSSE("error", { message: `Failed to parse ${file.originalname}` });
      }

      file.buffer = Buffer.alloc(0);
    }

    if (documentTexts.length === 0) {
      sendSSE("error", { message: "No text could be extracted from the uploaded files" });
      res.end();
      return;
    }

    store.addActivity("analysis", `Starting ${mode} analysis of ${documentTexts.length} document(s)`);
    sendSSE("status", { phase: "analyzing", message: `Starting ${mode} analysis with Venice AI...` });

    let fullResponse = "";
    const generator = streamAnalysis({
      mode: mode as any,
      customQuery,
      documentTexts,
    });

    for await (const chunk of generator) {
      fullResponse += chunk;
      sendSSE("chunk", { content: chunk });
    }

    documentTexts.length = 0;

    sendSSE("status", { phase: "complete", message: "Analysis complete. All document data purged from memory." });
    store.addActivity("analysis", `Analysis complete (${mode}). Documents purged from memory.`);

    const truncatedSummary = fullResponse.substring(0, 500);
    await sendMessage(
      `📋 <b>Document Analysis Complete</b>\n\nMode: ${mode}\nDocuments: ${files.length}\n\n${truncatedSummary}${fullResponse.length > 500 ? "..." : ""}`
    );

    const diemCost = `${getVeniceDiemCost()} DIEM`;
    if (x402Payment) {
      recordActionReceipt(
        "payment",
        `x402-paid analysis completed: ${mode} mode, ${files.length} documents, payment ${x402Payment.amount} USDC (compute: ${diemCost})`,
        x402Payment.txHash,
        x402Payment.amount,
        "USDC",
        x402Payment.from,
        {
          trigger: `x402 payment verified (${x402Payment.amount} USDC from ${x402Payment.from.slice(0, 10)}...)`,
          plan: `Process ${files.length} document(s) in ${mode} mode via Venice AI`,
          execution: `Analysis streamed successfully, ${fullResponse.length} chars produced, compute cost: ${diemCost}`,
          verification: `Payment tx ${x402Payment.txHash.slice(0, 16)}... confirmed on-chain`,
          outcome: `x402-paid analysis delivered successfully`,
        },
        diemCost
      );
    } else {
      recordActionReceipt(
        "payment",
        `Analysis completed: ${mode} mode, ${files.length} documents (admin-authenticated, compute: ${diemCost})`,
        undefined,
        "0",
        "USDC",
        "admin",
        {
          trigger: `Admin-authenticated analysis request (${files.length} document(s), ${mode} mode)`,
          plan: `Process ${files.length} document(s) in ${mode} mode via Venice AI`,
          execution: `Analysis streamed successfully, ${fullResponse.length} chars produced, compute cost: ${diemCost}`,
          verification: `Request authenticated via admin API token (internal proxy)`,
          outcome: `Analysis delivered to authenticated dashboard user`,
        },
        diemCost
      );
    }

    sendSSE("done", { message: "Stream complete" });
  } catch (err: any) {
    sendSSE("error", { message: err.message || "Analysis failed" });
    store.addActivity("system", `Analysis error: ${err.message}`);
  }

  res.end();
}

router.post("/analyze", x402Middleware, upload.array("files", 20), handleAnalysis);

export default router;
