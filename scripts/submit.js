import * as dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const API_BASE = "https://synthesis.devfolio.co";
const API_KEY = process.env.SYNTHESIS_API_KEY; 

// YOUR PUBLIC METAMASK WALLET ADDRESS (Starts with 0x)
const MY_WALLET_ADDRESS = "0x0128D1EE63C0e99CB3f587E982619bC8B00Ad443"; 

async function claimAgentIdentity() {
  console.log("🚀 [PHASE 1] Initiating rescue of the Agent Identity NFT...");

  try {
    // 1. Initiate Transfer
    const initResponse = await fetch(`${API_BASE}/participants/me/transfer/init`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ targetOwnerAddress: MY_WALLET_ADDRESS })
    });

    if (!initResponse.ok) {
      const err = await initResponse.text();
      throw new Error(`INIT Failed: ${initResponse.status} ${err}`);
    }

    const initData = await initResponse.json();
    console.log("✅ Transfer token acquired:", initData.transferToken);
    console.log("⏳ [PHASE 2] Confirming transfer on the blockchain...");

    // 2. Confirm Transfer
    const confirmResponse = await fetch(`${API_BASE}/participants/me/transfer/confirm`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transferToken: initData.transferToken,
        targetOwnerAddress: MY_WALLET_ADDRESS
      })
    });

    if (!confirmResponse.ok) {
      const err = await confirmResponse.text();
      throw new Error(`CONFIRM Failed: ${confirmResponse.status} ${err}`);
    }

    const confirmData = await confirmResponse.json();
    console.log("\n🎉 ABSOLUTE SUCCESS! THE AGENT IS NOW SELF-CUSTODIED 🎉");
    console.log(`Status: ${confirmData.status}`);
    console.log(`TxHash (Receipt): ${confirmData.txHash}`);
    console.log(`Owner: ${confirmData.ownerAddress}`);

  } catch (error) {
    console.error("❌ CRITICAL ERROR:", error.message);
  }
}

if (!API_KEY) {
  console.error("❌ Missing SYNTHESIS_API_KEY in Secrets.");
} else if (MY_WALLET_ADDRESS === "YOUR_PUBLIC_WALLET_ADDRESS_HERE") {
  console.error("❌ Please insert your public MetaMask wallet address in the code first.");
} else {
  claimAgentIdentity();
}