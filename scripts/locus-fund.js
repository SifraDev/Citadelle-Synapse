async function requestFunds() {
  console.log("Requesting initial USDC treasury from Locus (Authenticated)...");

  const API_KEY = "claw_dev_NYwjIR9a1CduNDY1-tYuTLsMCAN-pDOV"; 

  try {
    const response = await fetch("https://beta-api.paywithlocus.com/api/gift-code-requests", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${API_KEY}` 
      },
      body: JSON.stringify({
        email: "antoniolb14@gmail.com", 
        reason: "Building autonomous Legal Retainer agent at The Synthesis hackathon",
        requestedAmountUsdc: 10
      })
    });

    const data = await response.json();
    console.log("Response:", JSON.stringify(data, null, 2));

    if (data.success) {
      console.log("\n✅ SUCCESS: Check your email for the Gift Code!");
    }
  } catch (error) {
    console.error("❌ Error requesting funds:", error);
  }
}

requestFunds();