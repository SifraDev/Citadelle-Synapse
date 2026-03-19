import OpenAI from "openai";

const VENICE_BASE_URL = "https://api.venice.ai/api/v1";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.VENICE_API_KEY;
    if (!apiKey) {
      throw new Error("VENICE_API_KEY environment variable is not set");
    }
    client = new OpenAI({
      apiKey,
      baseURL: VENICE_BASE_URL,
    });
  }
  return client;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  summarize: `You are a senior legal analyst. Provide a comprehensive yet concise summary of the following legal document(s). Focus on: key parties involved, main obligations, important dates and deadlines, financial terms, and critical provisions. Structure your summary with clear headings.`,
  extract_clauses: `You are a senior legal analyst specializing in contract review. Extract and categorize all significant clauses from the following document(s). For each clause, provide: the clause type (e.g., indemnification, limitation of liability, termination, confidentiality, non-compete, force majeure, dispute resolution), a brief summary, and any notable terms or conditions. Flag any unusual or non-standard clauses.`,
  flag_risks: `You are a senior legal risk analyst. Analyze the following document(s) and identify all potential legal risks, liabilities, and areas of concern. For each risk, provide: risk severity (High/Medium/Low), description of the risk, relevant section or clause reference, and recommended mitigation strategy. Pay special attention to ambiguous language, missing protections, one-sided terms, and regulatory compliance issues.`,
  custom: `You are a senior legal analyst. Answer the following query about the provided document(s) thoroughly and accurately, citing specific sections where relevant.`,
};

export interface AnalysisOptions {
  mode: "summarize" | "extract_clauses" | "flag_risks" | "custom";
  customQuery?: string;
  documentTexts: string[];
}

const SANITIZE_PROMPT = `You are a senior legal privacy compliance officer. Your task is to take the following legal analysis and rewrite it so it is SAFE for external distribution. You MUST:

1. Replace ALL proper names (people, companies, organizations) with generic placeholders like [PARTY A], [PARTY B], [COMPANY X], etc.
2. Replace ALL specific addresses, phone numbers, email addresses, and physical locations with [ADDRESS REDACTED], [CONTACT REDACTED], etc.
3. Replace ALL specific financial amounts, account numbers, and monetary figures with [AMOUNT REDACTED] or [FINANCIAL DETAILS REDACTED]
4. Replace ALL dates that could identify the specific matter with [DATE REDACTED], but keep relative time references (e.g., "within 30 days" is fine)
5. Replace ALL case numbers, file references, and docket numbers with [REFERENCE REDACTED]
6. Preserve ALL legal analysis, conclusions, risk assessments, and recommendations — only redact identifying information
7. Maintain the exact same document structure, headings, and formatting

The output must be a complete, readable legal analysis that contains zero personally identifiable information (PII) while retaining full analytical value.`;

export async function sanitizeAnalysis(analysisText: string): Promise<string> {
  const ai = getClient();
  let result = "";

  const stream = await ai.chat.completions.create({
    model: "deepseek-v3.2",
    messages: [
      { role: "system", content: SANITIZE_PROMPT },
      { role: "user", content: analysisText },
    ],
    stream: true,
    max_tokens: 4096,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      result += content;
    }
  }

  return result;
}

export async function* streamAnalysis(options: AnalysisOptions): AsyncGenerator<string> {
  const ai = getClient();
  const systemPrompt = SYSTEM_PROMPTS[options.mode];
  
  let userContent = options.documentTexts
    .map((text, i) => `--- DOCUMENT ${i + 1} ---\n${text}\n--- END DOCUMENT ${i + 1} ---`)
    .join("\n\n");

  if (options.mode === "custom" && options.customQuery) {
    userContent = `QUERY: ${options.customQuery}\n\n${userContent}`;
  }

  const stream = await ai.chat.completions.create({
    model: "deepseek-v3.2",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    stream: true,
    max_tokens: 4096,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}
