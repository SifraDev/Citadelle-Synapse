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
  resetIntervalMs: number;
}

const DIEM_COST_PER_CALL: Record<BudgetCategory, number> = {
  venice: 0.04,
  rpc: 0.0001,
  uniswap: 0.005,
  locus: 0.002,
  telegram: 0.0005,
};

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
  lastResetAt: new Date().toISOString(),
  resetIntervalMs: 24 * 60 * 60 * 1000,
};

function checkAndResetIfNeeded(): void {
  const elapsed = Date.now() - new Date(state.lastResetAt).getTime();
  if (elapsed >= state.resetIntervalMs) {
    for (const cat of Object.keys(state.categories) as BudgetCategory[]) {
      state.categories[cat].used = 0;
      state.categories[cat].estimatedCost = 0;
    }
    state.overallUsed = 0;
    state.lastResetAt = new Date().toISOString();
    console.log("[Budget] Daily budget reset completed");
  }
}

export function trackCall(category: BudgetCategory, weight: number = 1): void {
  checkAndResetIfNeeded();
  state.categories[category].used += weight;
  state.categories[category].estimatedCost += DIEM_COST_PER_CALL[category] * weight;
  state.overallUsed += weight;
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

export function getVeniceDiemCost(weight: number = 1): string {
  return (DIEM_COST_PER_CALL.venice * weight).toFixed(4);
}

export function getBudgetStatus(): {
  categories: Record<string, { used: number; limit: number; percentUsed: number; estimatedCost: number; diemCost: number }>;
  overall: { used: number; limit: number; percentUsed: number };
  diem: { consumed: number; budget: number; percentUsed: number; unit: string };
  lastResetAt: string;
  nextResetAt: string;
} {
  checkAndResetIfNeeded();
  const categories: Record<string, { used: number; limit: number; percentUsed: number; estimatedCost: number; diemCost: number }> = {};
  for (const [key, val] of Object.entries(state.categories)) {
    categories[key] = {
      used: val.used,
      limit: val.limit,
      percentUsed: val.limit > 0 ? Math.round((val.used / val.limit) * 100) : 0,
      estimatedCost: parseFloat(val.estimatedCost.toFixed(4)),
      diemCost: parseFloat(val.estimatedCost.toFixed(4)),
    };
  }
  const veniceDiem = state.categories.venice.estimatedCost;
  const diemBudget = getDailyDiemBudget();
  const nextReset = new Date(new Date(state.lastResetAt).getTime() + state.resetIntervalMs);
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
    nextResetAt: nextReset.toISOString(),
  };
}

export function getBudgetSummaryForManifest(): {
  limits: Record<string, number>;
  dailyDiemBudget: number;
  diemUnit: string;
  diemDescription: string;
  resetInterval: string;
} {
  return {
    limits: Object.fromEntries(
      (Object.keys(state.categories) as BudgetCategory[]).map(k => [k, state.categories[k].limit])
    ),
    dailyDiemBudget: getDailyDiemBudget(),
    diemUnit: "DIEM",
    diemDescription: "1 DIEM = $1/day of Venice AI compute. Agent tracks consumption against daily budget to ensure efficient resource usage.",
    resetInterval: "24h",
  };
}
