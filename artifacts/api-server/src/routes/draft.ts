import { Router, type IRouter, type Request, type Response } from "express";
import { x402Middleware } from "../lib/x402.js";

const router: IRouter = Router();

router.post("/draft", x402Middleware, (req: Request, res: Response): void => {
  const { analysisText, mode } = req.body || {};

  if (!analysisText || typeof analysisText !== "string") {
    res.status(400).json({ error: "No analysis text provided" });
    return;
  }

  const title = mode === "extract_clauses"
    ? "Clause Extraction Report"
    : mode === "flag_risks"
      ? "Risk Assessment Report"
      : mode === "custom"
        ? "Custom Analysis Report"
        : "Legal Summary Report";

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  const lines = analysisText.split("\n");
  const pdfLines: string[] = [];
  const maxLineWidth = 80;

  for (const line of lines) {
    if (line.length <= maxLineWidth) {
      pdfLines.push(line);
    } else {
      const words = line.split(" ");
      let current = "";
      for (const word of words) {
        if ((current + " " + word).length > maxLineWidth && current) {
          pdfLines.push(current);
          current = word;
        } else {
          current = current ? current + " " + word : word;
        }
      }
      if (current) pdfLines.push(current);
    }
  }

  const pageHeight = 792;
  const pageWidth = 612;
  const margin = 72;
  const lineHeight = 14;
  const titleHeight = 24;
  const usableHeight = pageHeight - 2 * margin;
  const linesPerPage = Math.floor((usableHeight - titleHeight - 40) / lineHeight);

  const pages: string[][] = [];
  for (let i = 0; i < pdfLines.length; i += linesPerPage) {
    pages.push(pdfLines.slice(i, i + linesPerPage));
  }
  if (pages.length === 0) pages.push([]);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  let objNum = 1;

  const catalogObj = objNum++;
  const pagesObj = objNum++;
  const fontObj = objNum++;
  const boldFontObj = objNum++;

  const pageObjNums: number[] = [];
  const contentObjNums: number[] = [];

  for (let i = 0; i < pages.length; i++) {
    pageObjNums.push(objNum++);
    contentObjNums.push(objNum++);
  }

  const totalObjs = objNum;

  const escPdf = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  offsets[catalogObj] = pdf.length;
  pdf += `${catalogObj} 0 obj << /Type /Catalog /Pages ${pagesObj} 0 R >> endobj\n`;

  offsets[pagesObj] = pdf.length;
  const kids = pageObjNums.map((n) => `${n} 0 R`).join(" ");
  pdf += `${pagesObj} 0 obj << /Type /Pages /Kids [${kids}] /Count ${pages.length} >> endobj\n`;

  offsets[fontObj] = pdf.length;
  pdf += `${fontObj} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n`;

  offsets[boldFontObj] = pdf.length;
  pdf += `${boldFontObj} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj\n`;

  for (let i = 0; i < pages.length; i++) {
    const pageLines = pages[i];
    let stream = "";

    if (i === 0) {
      stream += `BT /F2 16 Tf ${margin} ${pageHeight - margin} Td (${escPdf(title)}) Tj ET\n`;
      stream += `BT /F1 8 Tf ${margin} ${pageHeight - margin - 20} Td (Generated: ${timestamp} | Mode: ${mode || "summarize"} | Venice AI Legal Platform) Tj ET\n`;
      stream += `${margin} ${pageHeight - margin - 30} m ${pageWidth - margin} ${pageHeight - margin - 30} l S\n`;
    }

    const startY = i === 0 ? pageHeight - margin - 50 : pageHeight - margin;

    for (let j = 0; j < pageLines.length; j++) {
      const y = startY - j * lineHeight;
      const lineText = escPdf(pageLines[j]);
      stream += `BT /F1 10 Tf ${margin} ${y} Td (${lineText}) Tj ET\n`;
    }

    stream += `BT /F1 8 Tf ${pageWidth - margin - 40} ${margin - 20} Td (Page ${i + 1}/${pages.length}) Tj ET\n`;

    offsets[contentObjNums[i]] = pdf.length;
    pdf += `${contentObjNums[i]} 0 obj << /Length ${stream.length} >> stream\n${stream}endstream endobj\n`;

    offsets[pageObjNums[i]] = pdf.length;
    pdf += `${pageObjNums[i]} 0 obj << /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentObjNums[i]} 0 R /Resources << /Font << /F1 ${fontObj} 0 R /F2 ${boldFontObj} 0 R >> >> >> endobj\n`;
  }

  const xrefStart = pdf.length;
  pdf += "xref\n";
  pdf += `0 ${totalObjs}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < totalObjs; i++) {
    pdf += `${String(offsets[i] || 0).padStart(10, "0")} 00000 n \n`;
  }

  pdf += "trailer\n";
  pdf += `<< /Size ${totalObjs} /Root ${catalogObj} 0 R >>\n`;
  pdf += "startxref\n";
  pdf += `${xrefStart}\n`;
  pdf += "%%EOF\n";

  const pdfBuffer = Buffer.from(pdf, "latin1");

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="safe-draft-${timestamp}.pdf"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.send(pdfBuffer);
});

export default router;
