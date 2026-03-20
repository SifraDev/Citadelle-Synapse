async function registerAgent() {
  console.log("Starting autonomous registration for Citadelle Agent on Locus Beta...");

  try {
    const response = await fetch("https://beta-api.paywithlocus.com/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        name: "Citadelle Legal Agent", 
        email: "antoniolb14@gmail.com" 
      })
    });

    const data = await response.json();

    console.log("\n✅ REGISTRATION SUCCESSFUL. SAVE THESE IN YOUR REPLIT SECRETS:");
    console.log("--------------------------------------------------");
    console.log("API KEY (LOCUS_API_KEY):", data.apiKey);
    console.log("PRIVATE KEY (LOCUS_PRIVATE_KEY):", data.ownerPrivateKey);
    console.log("--------------------------------------------------");
    console.log("Full response:", JSON.stringify(data, null, 2));

  } catch (error) {
    console.error("❌ Registration error:", error);
  }
}

registerAgent();