// artifacts/api-server/src/lib/locus.ts

const LOCUS_API_BASE = "https://beta-api.paywithlocus.com/api";

export interface LocusBalance {
  balance: string;
  token: string;
  wallet_address: string;
}

export async function getAgentBalance(): Promise<LocusBalance | null> {
  const apiKey = process.env.LOCUS_API_KEY;

  if (!apiKey) {
    console.error("[Treasury] ❌ LOCUS_API_KEY is missing in Secrets.");
    return null;
  }

  try {
    const response = await fetch(`${LOCUS_API_BASE}/pay/balance`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Locus API responded with status: ${response.status}`);
    }

    // Casteamos a 'any' para evitar que TypeScript marque error de tipado estricto
    const json = (await response.json()) as any;

    if (json.success && json.data) {
      console.log(`[Treasury] ✅ Balance verified: ${json.data.balance} ${json.data.token}`);
      return {
        balance: json.data.balance,
        token: json.data.token,
        wallet_address: json.data.wallet_address
      };
    } else {
      throw new Error(json.message || "Failed to parse balance data.");
    }
  } catch (error) {
    console.error("[Treasury] ❌ Failed to fetch balance:", error);
    return null;
  }
}