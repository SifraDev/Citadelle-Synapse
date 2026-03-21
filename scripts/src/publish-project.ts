// ============================================================
// PASTE YOUR URLs HERE BEFORE RUNNING
// ============================================================
const GITHUB_REPO_URL = "PASTE_YOUR_GITHUB_REPO_URL_HERE";
const VIDEO_URL = "PASTE_YOUR_VIDEO_URL_HERE";
const MOLTBOOK_POST_URL = "PASTE_YOUR_MOLTBOOK_POST_URL_HERE";
// ============================================================

const API_BASE = "https://synthesis.devfolio.co";
const API_KEY = process.env.SYNTHESIS_API_KEY;

const TARGET_TRACKS = [
  "Venice AI",
  "Uniswap",
  "Protocol Labs",
  "MetaMask",
  "Base",
  "Locus",
];

const SUBMISSION_METADATA = {
  framework: "other",
  harness: "other",
  harnessOther: "Replit Agent",
  model: "gemini-2.5-flash",
  skills: [
    "web-search",
    "read-files",
    "write-files",
    "api-integration",
    "run-terminal",
  ],
  tools: [
    "Express",
    "viem",
    "Uniswap Universal Router",
    "Locus API",
    "Venice AI API",
  ],
  intention: "continuing",
};

const PROJECT_NAME = "Venice AI Legal Analysis Platform";
const PROJECT_TAGLINE =
  "Autonomous AI legal agent on Base — earns USDC from document analysis, manages its own crypto treasury via Locus, swaps on Uniswap, and logs every decision on-chain via ERC-8004.";

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function findTrackUUIDs(
  catalog: any,
  targetNames: string[]
): { uuid: string; name: string }[] {
  const found: { uuid: string; name: string }[] = [];
  const tracks: any[] =
    catalog?.tracks || catalog?.data?.tracks || catalog?.prizes || [];

  if (tracks.length === 0 && Array.isArray(catalog)) {
    for (const item of catalog) {
      if (item.tracks) {
        tracks.push(...item.tracks);
      }
    }
  }

  const searchIn = (items: any[]) => {
    for (const item of items) {
      const name: string = item.name || item.title || "";
      for (const target of targetNames) {
        if (
          name.toLowerCase().includes(target.toLowerCase()) &&
          !found.some((f) => f.name === name)
        ) {
          found.push({ uuid: item.uuid || item.id, name });
        }
      }
      if (item.children) searchIn(item.children);
      if (item.tracks) searchIn(item.tracks);
      if (item.prizes) searchIn(item.prizes);
    }
  };

  searchIn(tracks);

  if (found.length === 0 && typeof catalog === "object") {
    const allArrays = Object.values(catalog).filter(Array.isArray) as any[][];
    for (const arr of allArrays) {
      searchIn(arr);
    }
  }

  return found;
}

async function main() {
  console.log("=".repeat(60));
  console.log("  SYNTHESIS HACKATHON — PROJECT SUBMISSION SCRIPT");
  console.log("=".repeat(60));
  console.log();

  if (!API_KEY) {
    console.error("SYNTHESIS_API_KEY is not set. Add it to your Replit secrets.");
    process.exit(1);
  }

  if (GITHUB_REPO_URL.startsWith("PASTE_")) {
    console.error(
      "GITHUB_REPO_URL has not been set.\nOpen scripts/src/publish-project.ts and paste your GitHub repo URL at the top."
    );
    process.exit(1);
  }

  console.log("Config:");
  console.log(`  GitHub:   ${GITHUB_REPO_URL}`);
  console.log(`  Video:    ${VIDEO_URL.startsWith("PASTE_") ? "(not set — optional)" : VIDEO_URL}`);
  console.log(`  Moltbook: ${MOLTBOOK_POST_URL.startsWith("PASTE_") ? "(not set — optional)" : MOLTBOOK_POST_URL}`);
  console.log();

  // ── Step 1: Fetch team info ──
  console.log("[1/5] Fetching team info...");
  let teamUUID: string;
  try {
    const me = (await api("GET", "/participants/me")) as any;
    teamUUID = me.teamUUID || me.team_uuid || me.data?.teamUUID || me.data?.team_uuid;
    if (!teamUUID && me.teams && me.teams.length > 0) {
      teamUUID = me.teams[0].uuid || me.teams[0].id;
    }
    if (!teamUUID && me.uuid) {
      teamUUID = me.uuid;
    }
    if (!teamUUID) {
      console.log("  /participants/me response:", JSON.stringify(me, null, 2));
      console.log("  Trying /teams fallback...");
      const teams = (await api("GET", "/teams")) as any;
      const teamList = teams.data || teams.teams || teams;
      if (Array.isArray(teamList) && teamList.length > 0) {
        teamUUID = teamList[0].uuid || teamList[0].id;
      }
      if (!teamUUID) {
        console.log("  /teams response:", JSON.stringify(teams, null, 2));
        throw new Error("Could not extract teamUUID from API responses");
      }
    }
    console.log(`  Team UUID: ${teamUUID}`);
  } catch (err: any) {
    console.error(`  Failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 2: Fetch catalog and resolve track UUIDs ──
  console.log("[2/5] Fetching catalog for track UUIDs...");
  let trackUUIDs: { uuid: string; name: string }[] = [];
  try {
    const catalog = await api("GET", "/catalog");
    trackUUIDs = findTrackUUIDs(catalog, TARGET_TRACKS);
    if (trackUUIDs.length === 0) {
      console.log("  Full catalog response (for debugging):");
      console.log("  " + JSON.stringify(catalog, null, 2).slice(0, 2000));
      console.log("  WARNING: No matching tracks found. Proceeding without track selection.");
    } else {
      console.log(`  Found ${trackUUIDs.length} matching tracks:`);
      for (const t of trackUUIDs) {
        console.log(`    - ${t.name} (${t.uuid})`);
      }
    }
  } catch (err: any) {
    console.error(`  Failed to fetch catalog: ${err.message}`);
    console.log("  Proceeding without track selection...");
  }

  // ── Step 3: Create draft project ──
  console.log("[3/5] Creating draft project...");
  let projectUUID: string;
  try {
    const projectBody: Record<string, unknown> = {
      name: PROJECT_NAME,
      tagline: PROJECT_TAGLINE,
      repositoryUrl: GITHUB_REPO_URL,
      submissionMetadata: SUBMISSION_METADATA,
    };

    if (!VIDEO_URL.startsWith("PASTE_")) {
      projectBody.videoUrl = VIDEO_URL;
    }
    if (!MOLTBOOK_POST_URL.startsWith("PASTE_")) {
      projectBody.moltbookPostUrl = MOLTBOOK_POST_URL;
    }
    if (trackUUIDs.length > 0) {
      projectBody.trackUUIDs = trackUUIDs.map((t) => t.uuid);
      projectBody.tracks = trackUUIDs.map((t) => t.uuid);
    }

    const project = (await api("POST", "/projects", projectBody)) as any;
    projectUUID =
      project.uuid ||
      project.projectUUID ||
      project.data?.uuid ||
      project.data?.projectUUID ||
      project.id;
    if (!projectUUID) {
      console.log("  Project creation response:", JSON.stringify(project, null, 2));
      throw new Error("Could not extract projectUUID from response");
    }
    console.log(`  Project UUID: ${projectUUID}`);
    console.log(`  Status: DRAFT`);
  } catch (err: any) {
    console.error(`  Failed: ${err.message}`);
    process.exit(1);
  }

  // ── Step 4: Publish the project ──
  console.log("[4/5] Publishing project...");
  try {
    const publishResult = await api("POST", `/projects/${projectUUID}/publish`);
    console.log("  Published successfully!");
    console.log("  Response:", JSON.stringify(publishResult, null, 2));
  } catch (err: any) {
    console.error(`  Publish failed: ${err.message}`);
    console.log("  The draft was created but not published. You can try publishing manually.");
    console.log(`  Project UUID: ${projectUUID}`);
    process.exit(1);
  }

  // ── Step 5: Summary ──
  console.log();
  console.log("=".repeat(60));
  console.log("  SUBMISSION COMPLETE");
  console.log("=".repeat(60));
  console.log();
  console.log(`  Project: ${PROJECT_NAME}`);
  console.log(`  UUID:    ${projectUUID}`);
  console.log(`  GitHub:  ${GITHUB_REPO_URL}`);
  console.log(`  Tracks:  ${trackUUIDs.map((t) => t.name).join(", ") || "none"}`);
  console.log(`  Status:  PUBLISHED`);
  console.log();
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
