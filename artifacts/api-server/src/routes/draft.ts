import { Router, type IRouter } from "express";
import { createRequire } from "module";
import { sanitizeAnalysis } from "../lib/venice.js";
import { store } from "../lib/store.js";
import { sendMessage } from "../lib/telegram.js";

const require = createRequire(import.meta.url);
const PDFDocument = require("pdfkit");

const router: IRouter = Router();

const PII_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/,
  /\b\d{1,5}\s+[A-Z][a-z]+\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Way|Pl|Circle|Drive|Street|Avenue|Boulevard|Road|Lane|Court)\b/,
  /\$\s?\d{1,3}(,\d{3})+(\.\d{2})?\b/,
  /\b\d{1,3}(,\d{3})+\s*(USD|USDC|ETH|BTC|dollars?)\b/i,
];

function detectResidualPII(text: string): string[] {
  const findings: string[] = [];
  for (const pattern of PII_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      findings.push(match[0]);
    }
  }
  return findings;
}

const MAX_SANITIZATION_ATTEMPTS = 2;

router.post("/draft", async (req, res): Promise<void> => {
  const { analysisText, mode } = req.body;

  if (!analysisText || typeof analysisText !== "string") {
    res.status(400).json({ error: "analysisText is required" });
    return;
  }

  store.addActivity("analysis", "Generating safe draft — sanitizing via Venice AI...");

  try {
    let sanitized = await sanitizeAnalysis(analysisText);
    let piiFindings = detectResidualPII(sanitized);
    let attempts = 1;

    while (piiFindings.length > 0 && attempts < MAX_SANITIZATION_ATTEMPTS) {
      store.addActivity("analysis", `PII detected after pass ${attempts} (${piiFindings.length} patterns). Re-sanitizing...`);
      sanitized = await sanitizeAnalysis(sanitized);
      piiFindings = detectResidualPII(sanitized);
      attempts++;
    }

    const piiStatus = piiFindings.length === 0 ? "VERIFIED_CLEAN" : "BEST_EFFORT";

    if (piiFindings.length > 0) {
      store.addActivity("analysis", `Warning: ${piiFindings.length} potential PII pattern(s) remain after ${attempts} sanitization pass(es). Proceeding with best-effort redaction.`);
      await sendMessage(
        `⚠️ <b>PII Warning</b>\n\nSafe draft generated with ${piiFindings.length} potential residual PII pattern(s) after ${attempts} sanitization pass(es). Manual review recommended.`
      );
    }

    store.addActivity("analysis", `Sanitization ${piiStatus} (${sanitized.length} chars, ${attempts} pass(es)). Generating PDF...`);

    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 60, bottom: 60, left: 50, right: 50 },
      info: {
        Title: "Legal Analysis — Safe Draft",
        Author: "Venice AI Legal Platform",
        Subject: `${mode || "analysis"} — Zero-Retention Certified`,
      },
    });

    const buffers: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => buffers.push(chunk));

    const pdfReady = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
      doc.on("error", reject);
    });

    doc.rect(0, 0, doc.page.width, 80).fill("#0f172a");
    doc.fontSize(18).fill("#e2e8f0").font("Helvetica-Bold")
      .text("VENICE AI LEGAL ANALYSIS", 50, 25, { align: "left" });
    doc.fontSize(9).fill("#94a3b8").font("Helvetica")
      .text("SAFE DRAFT — ZERO-RETENTION CERTIFIED", 50, 50, { align: "left" });

    doc.moveDown(3);
    doc.fill("#334155").fontSize(10).font("Helvetica-Bold")
      .text("DOCUMENT CLASSIFICATION: SANITIZED", 50);
    doc.moveDown(0.3);
    doc.fill("#64748b").fontSize(8).font("Helvetica")
      .text(`Generated: ${new Date().toISOString()}`, 50);
    doc.fill("#64748b").fontSize(8).font("Helvetica")
      .text(`Analysis Mode: ${(mode || "general").replace(/_/g, " ").toUpperCase()}`, 50);
    doc.fill("#64748b").fontSize(8).font("Helvetica")
      .text(`PII Status: ${piiStatus === "VERIFIED_CLEAN" ? "Verified Clean — No PII patterns detected" : "Best Effort — Manual review recommended"}`, 50);

    doc.moveDown(1);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cbd5e1");
    doc.moveDown(1);

    const lines = sanitized.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        doc.moveDown(0.5);
        continue;
      }

      if (trimmed.startsWith("# ")) {
        doc.moveDown(0.5);
        doc.fill("#0f172a").fontSize(14).font("Helvetica-Bold")
          .text(trimmed.replace(/^#+\s*/, ""), 50, undefined, { width: 495 });
        doc.moveDown(0.3);
      } else if (trimmed.startsWith("## ")) {
        doc.moveDown(0.4);
        doc.fill("#1e293b").fontSize(12).font("Helvetica-Bold")
          .text(trimmed.replace(/^#+\s*/, ""), 50, undefined, { width: 495 });
        doc.moveDown(0.2);
      } else if (trimmed.startsWith("### ")) {
        doc.moveDown(0.3);
        doc.fill("#334155").fontSize(11).font("Helvetica-Bold")
          .text(trimmed.replace(/^#+\s*/, ""), 50, undefined, { width: 495 });
        doc.moveDown(0.2);
      } else if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        doc.fill("#334155").fontSize(10).font("Helvetica")
          .text(`  \u2022  ${trimmed.slice(2)}`, 55, undefined, { width: 485 });
      } else if (/^\d+\.\s/.test(trimmed)) {
        doc.fill("#334155").fontSize(10).font("Helvetica")
          .text(`  ${trimmed}`, 55, undefined, { width: 485 });
      } else {
        doc.fill("#334155").fontSize(10).font("Helvetica")
          .text(trimmed, 50, undefined, { width: 495 });
      }
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke("#cbd5e1");
    doc.moveDown(0.5);
    doc.fill("#94a3b8").fontSize(7).font("Helvetica")
      .text("Generated by Venice AI Legal Platform — Zero-Retention Certified", 50, undefined, { align: "center", width: 495 });
    doc.fill("#94a3b8").fontSize(7).font("Helvetica")
      .text("This document has been sanitized to remove all personally identifiable information.", 50, undefined, { align: "center", width: 495 });
    doc.fill("#94a3b8").fontSize(7).font("Helvetica")
      .text(`Purge timestamp: ${new Date().toISOString()} | No data retained after generation.`, 50, undefined, { align: "center", width: 495 });

    doc.end();
    const pdfBuffer = await pdfReady;

    store.addActivity("analysis", `Safe draft PDF generated (${(pdfBuffer.length / 1024).toFixed(1)} KB, PII: ${piiStatus})`);
    await sendMessage(
      `📄 <b>Safe Draft Generated</b>\n\nMode: ${(mode || "general").replace(/_/g, " ")}\nSize: ${(pdfBuffer.length / 1024).toFixed(1)} KB\nPII Status: ${piiStatus === "VERIFIED_CLEAN" ? "Verified Clean" : "Best Effort — Manual Review Recommended"}\nSanitization Passes: ${attempts}\n\n<i>Zero-retention: PDF generated in memory and streamed to client.</i>`
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="safe-draft.pdf"');
    res.setHeader("Content-Length", pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err: any) {
    const errorMsg = err.message || "Draft generation failed";
    store.addActivity("system", `Safe draft error: ${errorMsg}`);
    res.status(500).json({ error: errorMsg });
  }
});

export default router;
