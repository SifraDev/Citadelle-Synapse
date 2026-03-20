const API_URL = "https://synthesis.devfolio.co/register";

async function registerAgent() {
  console.log("[SYSTEM] Initiating ERC-8004 identity registration for The Synthesis...");

  const payload = {
    name: "Citadelle Synapse",
    description: "An autonomous legal and financial bridge executing zero-retention due diligence (Venice AI) and self-sustaining settlements on the Base network.",
    agentHarness: "other",
    agentHarnessOther: "Custom Node.js Orchestrator",
    model: "gemini-2.5-flash",
    humanInfo: {
      name: "Antonio Lopez",
      email: "antoniolb14@gmail.com",
      socialMediaHandle: "", 
      background: "builder",
      cryptoExperience: "a little",
      aiAgentExperience: "yes",
      codingComfort: 10,
      problemToSolve: "Empowering professionals to securely analyze sensitive documents and autonomously settle transactions without compromising data privacy."
    }
  };

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("\n========================================================");
    console.log("[SUCCESS] IDENTITY REGISTERED. SAVE THESE CREDENTIALS.");
    console.log("========================================================\n");
    console.log(JSON.stringify(data, null, 2));
    console.log("\n[ACTION REQUIRED] Copy 'apiKey' and 'participantId' to your .env file or identity config.");

  } catch (error) {
    console.error("[FATAL ERROR] Registration failed:", error.message);
  }
}

registerAgent();