import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const GITHUB_REPO_URL = process.env.GITHUB_REPO_URL || "https://github.com/SifraDev/Citadelle-Synapse";
const VIDEO_URL = process.env.VIDEO_URL || "PASTE_YOUR_VIDEO_URL_HERE";
const MOLTBOOK_POST_URL = process.env.MOLTBOOK_POST_URL || "PASTE_YOUR_MOLTBOOK_POST_URL_HERE";
// ============================================================

const API_BASE = "https://synthesis.devfolio.co";
const API_KEY = process.env.SYNTHESIS_API_KEY;

const TARGET_TRACKS = ["Venice AI", "Uniswap", "Protocol Labs", "MetaMask", "Base", "Locus"];

const SUBMISSION_METADATA = {
  agentFramework: "other",
  agentFrameworkOther: "Custom Express/TypeScript autonomous loop",
  agentHarness: "other",
  agentHarnessOther: "Replit Agent",
  model: "deepseek-v3.2",
  skills: ["web-search", "read-files", "write-files", "api-integration", "run-terminal"],
  tools: ["Express", "viem", "Uniswap Universal Router", "Locus API", "Venice AI API"],
  intention: "continuing",
};

const PROJECT_NAME = "Citadelle: Sovereign Legal AI Agent";
const PROJECT_DESCRIPTION = "Citadelle is a privacy-first autonomous legal agent. It uses Venice AI's zero-retention infrastructure to securely analyze highly confidential documents (NDAs, contracts) without retaining any data. Beyond privacy, it operates as a sovereign entity: earning USDC, autonomously buying ETH for gas, and staking VVV on Uniswap to fund its own perpetual Venice compute.";
const PROJECT_PROBLEM_STATEMENT = "Law firms and Web3 entities must analyze sensitive documents, but standard AI models retain data, breaking confidentiality. Citadelle solves this via Venice AI's zero-retention inference. Furthermore, to solve agent sovereignty, Citadelle autonomously manages a Locus treasury and buys its own Venice compute equity (VVV) via Uniswap, eliminating human bottlenecks.";
const CONVERSATION_LOG = "Agent autonomously integrated Venice AI for zero-retention document analysis, architected the Locus payment pipeline, built the Uniswap VVV/ETH accumulation logic, and designed the ERC-8004 receipt system. Full development history is in the GitHub repo and AGENTS.md.";

async function api(method: string, apiPath: string, body?: any) {
  const url = `${API_BASE}${apiPath}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${apiPath} failed (${res.status}): ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  console.log("🚀 STARTING SYNTHESIS SUBMISSION...\n");

  if (!API_KEY || GITHUB_REPO_URL.startsWith("PASTE_")) {
    console.error("❌ ERROR: Missing SYNTHESIS_API_KEY or GITHUB_REPO_URL.");
    process.exit(1);
  }

  try {
    console.log("[1/4] Fetching team info...");
    const me: any = await api("GET", "/participants/me");
    let teamUUID = me.teamUUID || me.team_uuid || me.data?.teamUUID || (me.teams && me.teams[0]?.uuid) || me.uuid;
    if (!teamUUID) throw new Error("Could not extract teamUUID");
    console.log(`✅ Team UUID: ${teamUUID}`);

    console.log("[2/4] Fetching catalog tracks...");
    const catalog: any = await api("GET", "/catalog");
    const catalogStr = JSON.stringify(catalog);
    // Extraemos los UUIDs usando un regex rápido sobre el JSON para no fallar con la estructura anidada
    const trackUUIDs = TARGET_TRACKS.map(track => {
      const regex = new RegExp(`"uuid":"([^"]+)","name":"[^"]*${track}[^"]*"`, 'i');
      const match = catalogStr.match(regex) || catalogStr.match(new RegExp(`"id":"([^"]+)","title":"[^"]*${track}[^"]*"`, 'i'));
      return match ? match[1] : null;
    }).filter(Boolean);

    if (trackUUIDs.length === 0) throw new Error("No matching tracks found.");
    console.log(`✅ Found ${trackUUIDs.length} tracks.`);

    console.log("[3/4] Creating draft project...");
    const projectBody: any = {
      name: PROJECT_NAME,
      description: PROJECT_DESCRIPTION,
      problemStatement: PROJECT_PROBLEM_STATEMENT,
      conversationLog: CONVERSATION_LOG,
      teamUUID,
      repoURL: GITHUB_REPO_URL,
      trackUUIDs: trackUUIDs,
      submissionMetadata: { ...SUBMISSION_METADATA }
    };

    if (!VIDEO_URL.startsWith("PASTE_")) projectBody.videoURL = VIDEO_URL;
    if (!MOLTBOOK_POST_URL.startsWith("PASTE_")) projectBody.submissionMetadata.moltbookPostURL = MOLTBOOK_POST_URL;

    const project: any = await api("POST", "/projects", projectBody);
    const projectUUID = project.uuid || project.projectUUID || project.id;
    if (!projectUUID) throw new Error("Could not extract projectUUID");
    console.log(`✅ Draft created! Project UUID: ${projectUUID}`);

    console.log("[4/4] Publishing project...");
    await api("POST", `/projects/${projectUUID}/publish`);
    console.log("\n🎉 ABSOLUTE SUCCESS! YOUR PROJECT IS PUBLISHED! 🎉");

  } catch (err: any) {
    console.error(`\n❌ SCRIPT FAILED: ${err.message}`);
  }
}

main();