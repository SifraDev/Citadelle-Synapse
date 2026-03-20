type BudgetCategory = "venice" | "rpc" | "uniswap" | "locus" | "telegram";

interface CategoryBudget {
  used: number;
  limit: number;
  estimatedCost: number;
}

interface BudgetState {
  categories: Record<BudgetCategory, CategoryBudget>;
  overallLimit: number;
  overallUsed: number;
  lastResetAt: string;
}

const VENICE_DIEM_PER_1K_TOKENS = 0.002;

const DEFAULT_LIMITS: Record<BudgetCategory, number> = {
  venice: 200,
  rpc: 5000,
  uniswap: 100,
  locus: 500,
  telegram: 1000,
};

const DEFAULT_DAILY_DIEM_BUDGET = 5.0;

function getLimit(category: BudgetCategory): number {
  const envKey = `BUDGET_LIMIT_${category.toUpperCase()}`;
  const envVal = process.env[envKey];
  if (envVal && !isNaN(parseInt(envVal))) return parseInt(envVal);
  return DEFAULT_LIMITS[category];
}

function getOverallLimit(): number {
  const envVal = process.env.BUDGET_LIMIT_OVERALL;
  if (envVal && !isNaN(parseInt(envVal))) return parseInt(envVal);
  return 10000;
}

function getDailyDiemBudget(): number {
  const envVal = process.env.BUDGET_DIEM_DAILY;
  if (envVal && !isNaN(parseFloat(envVal))) return parseFloat(envVal);
  return DEFAULT_DAILY_DIEM_BUDGET;
}

function getNextMidnightUTC(): Date {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return next;
}

function getTodayMidnightUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

const state: BudgetState = {
  categories: {
    venice: { used: 0, limit: getLimit("venice"), estimatedCost: 0 },
    rpc: { used: 0, limit: getLimit("rpc"), estimatedCost: 0 },
    uniswap: { used: 0, limit: getLimit("uniswap"), estimatedCost: 0 },
    locus: { used: 0, limit: getLimit("locus"), estimatedCost: 0 },
    telegram: { used: 0, limit: getLimit("telegram"), estimatedCost: 0 },
  },
  overallLimit: getOverallLimit(),
  overallUsed: 0,
  lastResetAt: getTodayMidnightUTC().toISOString(),
};

function checkAndResetIfNeeded(): void {
  const lastReset = new Date(state.lastResetAt);
  const todayMidnight = getTodayMidnightUTC();
  if (lastReset < todayMidnight) {
    for (const cat of Object.keys(state.categories) as BudgetCategory[]) {
      state.categories[cat].used = 0;
      state.categories[cat].estimatedCost = 0;
    }
    state.overallUsed = 0;
    state.lastResetAt = todayMidnight.toISOString();
    console.log("[Budget] Daily budget reset at midnight UTC");
  }
}

export function trackCall(category: BudgetCategory, weight: number = 1): void {
  checkAndResetIfNeeded();
  state.categories[category].used += weight;
  state.overallUsed += weight;
}

export function trackVeniceDiem(estimatedTokens: number): void {
  checkAndResetIfNeeded();
  const diemCost = (estimatedTokens / 1000) * VENICE_DIEM_PER_1K_TOKENS;
  state.categories.venice.estimatedCost += diemCost;
}

export function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

export function canCall(category: BudgetCategory): boolean {
  checkAndResetIfNeeded();
  const cat = state.categories[category];
  if (cat.used >= cat.limit) {
    console.warn(`[Budget] Category "${category}" exhausted: ${cat.used}/${cat.limit}`);
    return false;
  }
  if (state.overallUsed >= state.overallLimit) {
    console.warn(`[Budget] Overall budget exhausted: ${state.overallUsed}/${state.overallLimit}`);
    return false;
  }
  if (category === "venice") {
    const veniceDiem = state.categories.venice.estimatedCost;
    const diemBudget = getDailyDiemBudget();
    if (veniceDiem >= diemBudget) {
      console.warn(`[Budget] Venice DIEM budget exhausted: ${veniceDiem.toFixed(4)}/${diemBudget} DIEM`);
      return false;
    }
  }
  return true;
}

export function getVeniceDiemCost(estimatedTokens: number = 4096): string {
  const cost = (estimatedTokens / 1000) * VENICE_DIEM_PER_1K_TOKENS;
  return cost.toFixed(4);
}

export function getBudgetStatus(): {
  categories: Record<string, { used: number; limit: number; percentUsed: number; diemCost: number }>;
  overall: { used: number; limit: number; percentUsed: number };
  diem: { consumed: number; budget: number; percentUsed: number; unit: string };
  lastResetAt: string;
  nextResetAt: string;
} {
  checkAndResetIfNeeded();
  const categories: Record<string, { used: number; limit: number; percentUsed: number; diemCost: number }> = {};
  for (const [key, val] of Object.entries(state.categories)) {
    categories[key] = {
      used: val.used,
      limit: val.limit,
      percentUsed: val.limit > 0 ? Math.round((val.used / val.limit) * 100) : 0,
      diemCost: parseFloat(val.estimatedCost.toFixed(4)),
    };
  }
  const veniceDiem = state.categories.venice.estimatedCost;
  const diemBudget = getDailyDiemBudget();
  return {
    categories,
    overall: {
      used: state.overallUsed,
      limit: state.overallLimit,
      percentUsed: state.overallLimit > 0 ? Math.round((state.overallUsed / state.overallLimit) * 100) : 0,
    },
    diem: {
      consumed: parseFloat(veniceDiem.toFixed(4)),
      budget: diemBudget,
      percentUsed: diemBudget > 0 ? Math.round((veniceDiem / diemBudget) * 100) : 0,
      unit: "DIEM",
    },
    lastResetAt: state.lastResetAt,
    nextResetAt: getNextMidnightUTC().toISOString(),
  };
}

export function getBudgetSummaryForManifest(): {
  limits: Record<string, number>;
  dailyDiemBudget: number;
  diemUnit: string;
  diemDescription: string;
  diemPricing: string;
  resetInterval: string;
} {
  return {
    limits: Object.fromEntries(
      (Object.keys(state.categories) as BudgetCategory[]).map(k => [k, state.categories[k].limit])
    ),
    dailyDiemBudget: getDailyDiemBudget(),
    diemUnit: "DIEM",
    diemDescription: "1 DIEM = $1/day of Venice AI compute. Agent tracks Venice token consumption against daily DIEM budget to ensure efficient resource usage.",
    diemPricing: `${VENICE_DIEM_PER_1K_TOKENS} DIEM per 1K tokens (prompt + completion)`,
    resetInterval: "24h (midnight UTC)",
  };
}
