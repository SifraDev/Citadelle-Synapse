import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import { createRequire } from "module";
import { streamAnalysis } from "../lib/venice.js";
import { store } from "../lib/store.js";
import { sendMessage } from "../lib/telegram.js";
import { x402Middleware, getX402PricingInfo, type X402PaymentContext } from "../lib/x402.js";
import { recordActionReceipt } from "../lib/erc8004.js";
import { getVeniceDiemCost, estimateTokensFromText } from "../lib/budget.js";

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
    // ACEPTAR PDF Y TXT (Plan B de emergencia)
    if (file.mimetype === "application/pdf" || file.mimetype === "text/plain") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and TXT files are accepted"));
    }
  },
});

async function handleAnalysis(req: Request, res: Response): Promise<void> {
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files || files.length === 0) {
    res.status(400).json({ error: "No files provided" });
    return;
  }

  const mode = (req.body?.mode as string) || "summarize";
  const customQuery = req.body?.customQuery as string | undefined;
  const validModes = ["summarize", "extract_clauses", "flag_risks", "custom"];
  if (!validModes.includes(mode)) {
    res.status(400).json({ error: `Invalid mode. Must be one of: ${validModes.join(", ")}` });
    return;
  }

  store.addActivity("upload", `${files.length} file(s) uploaded for analysis`, {
    fileNames: files.map((f) => f.originalname),
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
    sendSSE("status", { phase: "extracting", message: "Extracting text..." });

    const documentTexts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      sendSSE("status", { phase: "extracting", message: `Processing ${file.originalname}...` });

      try {
        let extractedText = "";

        // MODO SEGURO: Si es TXT lo lee directo, si es PDF usa el parser arreglado
        if (file.mimetype === "text/plain" || file.originalname.endsWith('.txt')) {
            extractedText = file.buffer.toString("utf-8");
        } else {
            const dataBuffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
            const parsed = await pdfParse(dataBuffer);
            extractedText = parsed.text;
        }

        if (extractedText && extractedText.trim()) {
            documentTexts.push(extractedText);
            sendSSE("status", { phase: "extracted", message: `Extracted text from ${file.originalname}` });
        } else {
            throw new Error("Text was empty after parsing");
        }
      } catch (err: any) {
        console.error(`[PARSE ERROR] File: ${file.originalname}`, err);
        sendSSE("error", { message: `Failed to extract text from ${file.originalname}` });
      }

      file.buffer = Buffer.alloc(0);
    }

    if (documentTexts.length === 0) {
      sendSSE("error", { message: "No text could be extracted from the uploaded files" });
      res.end();
      return;
    }

    store.addActivity("analysis", `Starting ${mode} analysis`);
    sendSSE("status", { phase: "analyzing", message: `Starting ${mode} analysis with Venice AI...` });

    let fullResponse = "";
    const generator = streamAnalysis({ mode: mode as any, customQuery, documentTexts });
    const totalInputChars = documentTexts.reduce((s, t) => s + t.length, 0);

    for await (const chunk of generator) {
      fullResponse += chunk;
      sendSSE("chunk", { content: chunk });
    }

    documentTexts.length = 0;
    sendSSE("status", { phase: "complete", message: "Analysis complete. All document data purged from memory." });
    store.addActivity("analysis", `Analysis complete (${mode}). Documents purged from memory.`);

    const diemCost = `${getVeniceDiemCost(Math.ceil(totalInputChars / 4) + Math.ceil(fullResponse.length / 4))} DIEM`;

    if (x402Payment) {
      recordActionReceipt("payment", `x402-paid analysis completed`, x402Payment.txHash, x402Payment.amount, "USDC", x402Payment.from, { trigger: "x402 payment", plan: "Process document", execution: "Analysis streamed", verification: "Payment confirmed", outcome: "Delivered" }, diemCost);
    }

    sendSSE("done", { message: "Stream complete" });
  } catch (err: any) {
    sendSSE("error", { message: err.message || "Analysis failed" });
  }

  res.end();
}

router.post("/analyze", x402Middleware, upload.array("files", 20), handleAnalysis);

export default router;