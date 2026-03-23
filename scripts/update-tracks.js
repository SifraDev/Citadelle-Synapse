import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const API_BASE = "https://synthesis.devfolio.co";
const API_KEY = process.env.SYNTHESIS_API_KEY; 
const PROJECT_UUID = "aaaf9419dbdf4c2e958f1120afd15ada";

async function updateTracks() {
  console.log("[SYSTEM] Initiating precise track assignment sequence...\n");
  const headers = { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" };

  try {
    console.log("[PHASE 1] Fetching official hackathon catalog...");
    const catalogRes = await fetch(`${API_BASE}/catalog`);
    if (!catalogRes.ok) throw new Error(`Catalog fetch failed: ${catalogRes.status}`);
    const catalogData = await catalogRes.json();

    const targetPhrases = [
      "private agents, trusted actions", // Venice
      "best use of delegations",         // MetaMask
      "agentic finance",                 // Uniswap
      "best use of locus",               // Locus
      "agent services on base",          // Base
      "let the agent cook",              // Protocol Labs
      "agents with receipts",            // Protocol Labs
      "synthesis open track"             // Synthesis Main Pool
    ];

    const selectedTracks = catalogData.items.filter(track => {
       const trackName = track.name.toLowerCase();
       return targetPhrases.some(phrase => trackName.includes(phrase));
    });

    const trackUUIDs = selectedTracks.map(t => t.uuid);

    console.log(`\n -> Verified ${trackUUIDs.length} exact target tracks for Citadelle Synapse:`);
    selectedTracks.forEach(t => console.log(`    [✓] ${t.company || 'Synthesis'}: ${t.name}`));

    if (trackUUIDs.length === 0) {
        console.log("\n[WARNING] No tracks matched. Please check the catalog data.");
        return;
    }

    console.log("\n[PHASE 2] Injecting validated tracks into published project...");
    const updateRes = await fetch(`${API_BASE}/projects/${PROJECT_UUID}`, {
       method: "POST",
       headers,
       body: JSON.stringify({ trackUUIDs })
    });

    if (!updateRes.ok) throw new Error(`Project update failed: ${await updateRes.text()}`);

    console.log("\n========================================================");
    console.log("[SUCCESS] TRACKS OFFICIALLY UPDATED IN DEVFOLIO");
    console.log("========================================================\n");
  } catch (err) {
    console.error("\n[FATAL ERROR] Track update sequence failed:", err.message);
  }
}

if (!API_KEY) {
  console.error("[ERROR] Missing SYNTHESIS_API_KEY environment variable.");
} else {
  updateTracks();
}