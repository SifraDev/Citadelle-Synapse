import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { store } from "./store.js";

const UNISWAP_UNIVERSAL_ROUTER_BASE = "0x6fF5693b99212Da76ad316178A184AB56D299b43" as const;

const DOMAIN = {
  name: "Venice AI Legal Platform",
  version: "1",
  chainId: 8453,
} as const;

const DELEGATION_TYPES = {
  Delegation: [
    { name: "delegate", type: "address" },
    { name: "allowedContract", type: "address" },
    { name: "dailyLimitUsdc", type: "uint256" },
    { name: "expiresAt", type: "uint256" },
  ],
} as const;

export interface DelegationData {
  delegator: string;
  delegate: string;
  allowedContract: string;
  dailyLimitUsdc: number;
  expiresAt: number;
  signature: string;
  signedAt: string;
}

export interface DelegationStatus {
  active: boolean;
  delegator?: string;
  delegate?: string;
  dailyLimitUsdc?: number;
  dailyUsedUsdc?: number;
  dailyRemainingUsdc?: number;
  expiresAt?: string;
  expired?: boolean;
  signedAt?: string;
  reason?: string;
}

let _currentDelegation: DelegationData | null = null;

const _dailyUsage: Map<string, number> = new Map();

function getDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getDailyUsed(): number {
  return _dailyUsage.get(getDayKey()) || 0;
}

function getAgentAccountAddress(): string | null {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) return null;
  try {
    const account = privateKeyToAccount(pk.startsWith("0x") ? (pk as `0x${string}`) : `0x${pk}`);
    return account.address.toLowerCase();
  } catch {
    return null;
  }
}

export function getEIP712DelegationTypes() {
  return {
    domain: DOMAIN,
    types: DELEGATION_TYPES,
    primaryType: "Delegation" as const,
    allowedContract: UNISWAP_UNIVERSAL_ROUTER_BASE,
  };
}

export async function storeDelegation(
  delegator: string,
  delegate: string,
  allowedContract: string,
  dailyLimitUsdc: number,
  expiresAt: number,
  signature: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const agentAddress = getAgentAccountAddress();
    if (!agentAddress) {
      return { success: false, error: "Agent wallet not configured (PRIVATE_KEY missing)" };
    }

    if (delegate.toLowerCase() !== agentAddress) {
      return { success: false, error: `Delegate must be the agent wallet (${agentAddress}), got ${delegate}` };
    }

    if (allowedContract.toLowerCase() !== UNISWAP_UNIVERSAL_ROUTER_BASE.toLowerCase()) {
      return { success: false, error: `AllowedContract must be Uniswap Universal Router (${UNISWAP_UNIVERSAL_ROUTER_BASE})` };
    }

    const message = {
      delegate: delegate as `0x${string}`,
      allowedContract: allowedContract as `0x${string}`,
      dailyLimitUsdc: BigInt(Math.round(dailyLimitUsdc * 1e6)),
      expiresAt: BigInt(expiresAt),
    };

    const valid = await verifyTypedData({
      address: delegator as `0x${string}`,
      domain: DOMAIN,
      types: DELEGATION_TYPES,
      primaryType: "Delegation",
      message,
      signature: signature as `0x${string}`,
    });

    if (!valid) {
      return { success: false, error: "Invalid signature — ecrecover mismatch" };
    }

    _currentDelegation = {
      delegator,
      delegate,
      allowedContract,
      dailyLimitUsdc,
      expiresAt,
      signature,
      signedAt: new Date().toISOString(),
    };

    store.addActivity("system", `Delegation granted by ${delegator.slice(0, 10)}... — limit ${dailyLimitUsdc} USDC/day, expires ${new Date(expiresAt * 1000).toISOString()}`);

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Signature verification failed: ${msg}` };
  }
}

export function verifyDelegation(proposedAmountUsdc: number): {
  allowed: boolean;
  reason?: string;
} {
  if (!_currentDelegation) {
    return { allowed: false, reason: "No active delegation — owner must sign in dashboard" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now >= _currentDelegation.expiresAt) {
    return { allowed: false, reason: "Delegation expired — owner must re-sign" };
  }

  const agentAddress = getAgentAccountAddress();
  if (agentAddress && _currentDelegation.delegate.toLowerCase() !== agentAddress) {
    return { allowed: false, reason: "Delegation delegate does not match current agent wallet" };
  }

  if (_currentDelegation.allowedContract.toLowerCase() !== UNISWAP_UNIVERSAL_ROUTER_BASE.toLowerCase()) {
    return { allowed: false, reason: "Delegation allowedContract does not match Uniswap Universal Router" };
  }

  const dailyUsed = getDailyUsed();
  if (dailyUsed + proposedAmountUsdc > _currentDelegation.dailyLimitUsdc) {
    return {
      allowed: false,
      reason: `Daily limit exceeded — used ${dailyUsed.toFixed(2)}/${_currentDelegation.dailyLimitUsdc} USDC today`,
    };
  }

  return { allowed: true };
}

export function recordDailyUsage(amountUsdc: number): void {
  const key = getDayKey();
  const current = _dailyUsage.get(key) || 0;
  _dailyUsage.set(key, current + amountUsdc);
}

export function getDelegationStatus(): DelegationStatus {
  if (!_currentDelegation) {
    return { active: false, reason: "No delegation signed" };
  }

  const now = Math.floor(Date.now() / 1000);
  const expired = now >= _currentDelegation.expiresAt;
  const dailyUsed = getDailyUsed();

  return {
    active: !expired,
    delegator: _currentDelegation.delegator,
    delegate: _currentDelegation.delegate,
    dailyLimitUsdc: _currentDelegation.dailyLimitUsdc,
    dailyUsedUsdc: parseFloat(dailyUsed.toFixed(6)),
    dailyRemainingUsdc: parseFloat(Math.max(0, _currentDelegation.dailyLimitUsdc - dailyUsed).toFixed(6)),
    expiresAt: new Date(_currentDelegation.expiresAt * 1000).toISOString(),
    expired,
    signedAt: _currentDelegation.signedAt,
  };
}

export function clearDelegation(): void {
  _currentDelegation = null;
  _dailyUsage.clear();
}
