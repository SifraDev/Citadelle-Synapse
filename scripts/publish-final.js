import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const API_BASE = "https://synthesis.devfolio.co";
const API_KEY = process.env.SYNTHESIS_API_KEY; 
const MY_WALLET_ADDRESS = "0x0128D1EE63C0e99CB3f587E982619bC8B00Ad443"; 

async function submitProject() {
  console.log("[SYSTEM] Initiating project submission sequence...\n");

  const headers = {
    "Authorization": `Bearer ${API_KEY}`,
    "Content-Type": "application/json"
  };

  try {
    // ---------------------------------------------------------
    console.log("[PHASE 1] Verifying Self-Custody (ERC-8004)...");
    const initRes = await fetch(`${API_BASE}/participants/me/transfer/init`, {
      method: "POST", headers, body: JSON.stringify({ targetOwnerAddress: MY_WALLET_ADDRESS })
    });

    if (initRes.status === 409) {
      console.log(" -> Self-custody already established. Proceeding.");
    } else if (!initRes.ok) {
      throw new Error(`Transfer initiation failed: ${await initRes.text()}`);
    } else {
      const initData = await initRes.json();
      const confirmRes = await fetch(`${API_BASE}/participants/me/transfer/confirm`, {
        method: "POST", headers, body: JSON.stringify({
          transferToken: initData.transferToken,
          targetOwnerAddress: MY_WALLET_ADDRESS
        })
      });
      if (!confirmRes.ok) throw new Error(`Transfer confirmation failed: ${await confirmRes.text()}`);
      console.log(" -> Agent successfully transferred to wallet.");
    }

    // ---------------------------------------------------------
    console.log("\n[PHASE 2] Resolving Team UUID...");
    const teamRes = await fetch(`${API_BASE}/teams`, {
      method: "POST", headers, body: JSON.stringify({ name: "Citadelle Founders" })
    });

    // 409 significa que ya tienes un equipo, así que lo obtenemos de otra forma si falla la creación
    let teamData;
    if (teamRes.status === 409) {
        console.log(" -> Team already exists, fetching current team...");
        const getTeamRes = await fetch(`${API_BASE}/teams/me`, { method: "GET", headers });
        if (getTeamRes.ok) teamData = await getTeamRes.json();
    } else if (!teamRes.ok) {
        throw new Error(`Team resolution failed: ${await teamRes.text()}`);
    } else {
        teamData = await teamRes.json();
    }

    // Aquí está la magia: buscamos teamId (lo que vimos en tu consola) o uuid
    const teamUUID = teamData?.teamId || teamData?.uuid || teamData?.id || "e98616a0c68b4cd788165a2b94808f23";

    console.log(` -> Team registered. UUID/ID: ${teamUUID}`);

    // ---------------------------------------------------------
    console.log("\n[PHASE 3] Fetching Hackathon Tracks...");
    const catalogRes = await fetch(`${API_BASE}/catalog`);
    const catalogData = await catalogRes.json();
    const trackUUIDs = catalogData.items.slice(0, 3).map(t => t.uuid);
    console.log(` -> Enrolled in ${trackUUIDs.length} tracks.`);

    // ---------------------------------------------------------
    console.log("\n[PHASE 4] Drafting Project Metadata...");
    const projectPayload = {
      teamUUID: teamUUID,
      name: "Citadelle Synapse",
      description: "An autonomous sovereign legal agent on the Base network. It uses Venice AI for zero-retention document redaction and Locus for secure on-chain escrow payments via Telegram.",
      problemStatement: "Law firms handle multi-million dollar secrets but cannot use standard AI due to data retention risks. Furthermore, intake and billing are manual, high-friction processes. Citadelle solves this by using zero-retention AI (Venice) and fully autonomous on-chain escrow payments (Locus on Base).",
      repoURL: "https://github.com/SifraDev/Citadelle-Synapse",
      trackUUIDs: trackUUIDs,
      conversationLog: "Human: Initialize project.\nAgent: Scaffolded Replit.\nHuman: Add Venice AI integration for zero-retention analysis.\nAgent: Added pdf-parse and Venice API streaming.\nHuman: Add Telegram intake and Locus escrow.\nAgent: Built autonomous Telegram bot and Locus payment generation.\nHuman: Implement MetaMask ERC-7715 delegation.\nAgent: Built React frontend for treasury management.\nHuman: Fix ethers.js connection.\nAgent: Migrated logic to BrowserProvider for robust connections.",
      submissionMetadata: {
        agentFramework: "other",
        agentFrameworkOther: "Custom Node.js Orchestrator via Replit Agent",
        agentHarness: "other",
        agentHarnessOther: "Replit Agent",
        model: "gemini-2.5-flash",
        skills: ["web-search", "react-best-practices", "ethers-v6-integration"],
        tools: ["Base Network", "Locus", "Venice AI", "MetaMask", "Uniswap", "ethers", "Express", "Vite"],
        helpfulResources: ["https://docs.base.org/"],
        helpfulSkills: [
          { name: "ethers-v6-integration", reason: "Crucial for handling complex MetaMask connection states and ERC-7715 delegations." }
        ],
        intention: "continuing",
        intentionNotes: "We plan to expand the agent to automatically deploy isolated escrow smart contracts per client.",
        moltbookPostURL: "https://www.moltbook.com/post/f4b7d70f-4a15-4798-8b5a-5daa8f763b3c"
      }
    };

    let projectUUID;
    const draftRes = await fetch(`${API_BASE}/projects`, {
      method: "POST", headers, body: JSON.stringify(projectPayload)
    });

    if (draftRes.status === 409) {
      console.log(" -> Project already exists. We will update and publish it.");
      // Asumimos que el proyecto ya está atado al equipo
      projectUUID = teamUUID; // Fallback temporal, si falla lo arreglamos
    } else if (!draftRes.ok) {
      throw new Error(`Draft creation failed: ${await draftRes.text()}`);
    } else {
      const draftData = await draftRes.json();
      projectUUID = draftData.uuid || draftData.projectId || draftData.id;
    }
    console.log(` -> Draft ready. Project UUID: ${projectUUID}`);

    // ---------------------------------------------------------
    console.log("\n[PHASE 5] Publishing Official Project...");
    const publishRes = await fetch(`${API_BASE}/projects/${projectUUID}/publish`, {
      method: "POST", headers
    });

    if (!publishRes.ok) throw new Error(`Publish execution failed: ${await publishRes.text()}`);
    const publishData = await publishRes.json();

    console.log("\n========================================================");
    console.log("[SUCCESS] PROJECT OFFICIALLY PUBLISHED");
    console.log("========================================================");
    console.log(`Project Name : ${publishData.name || "Citadelle Synapse"}`);
    console.log(`Status       : ${(publishData.status || 'published').toUpperCase()}`);
    console.log("========================================================\n");

  } catch (error) {
    console.error("\n[FATAL ERROR] Submission process terminated:", error.message);
  }
}

if (!API_KEY) {
  console.error("[ERROR] Missing SYNTHESIS_API_KEY environment variable.");
} else {
  submitProject();
}