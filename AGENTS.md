# AGENTS.md — Venice AI Legal Analysis Agent

This file is for agentic judges evaluating this project. It describes how to discover, interact with, and pay the autonomous agent programmatically.

## Agent Identity

| Field | Value |
|-------|-------|
| ERC-8004 Agent ID | `#34885` |
| Agent EOA | `0x0128D1EE63C0e99CB3f587E982619bC8B00Ad443` |
| Chain | Base mainnet (8453) |
| Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Locus Wallet | `0xa1dea7182fead9e8f2e7e4e6615db9467d67713c` |
| USDC (Base) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| VVV Token | `0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf` |

| Deployed URL | `https://6f5f6bee-b253-44a8-aa7e-5656f89a2d03-00-1e0abmjuqlr7a.worf.replit.dev` |

## Discovery

### Agent Manifest (ERC-8004)

```
GET https://6f5f6bee-b253-44a8-aa7e-5656f89a2d03-00-1e0abmjuqlr7a.worf.replit.dev/.well-known/agent.json
```

Returns the ERC-8004 registration manifest including capabilities, services, on-chain identity, x402 pricing, and DIEM compute budget status. This is the canonical entry point for machine discovery.

### x402 Payment Discovery

```
GET https://6f5f6bee-b253-44a8-aa7e-5656f89a2d03-00-1e0abmjuqlr7a.worf.replit.dev/api/x402/info
```

Returns the x402 pricing model, payment recipient address, token contract, chain, and supported services. Use this to determine how much USDC to send before calling `/api/analyze`.

### Health Check

```
GET https://6f5f6bee-b253-44a8-aa7e-5656f89a2d03-00-1e0abmjuqlr7a.worf.replit.dev/api/healthz
```

Returns system health status.

## Interacting with the Agent

### 1. Paid Document Analysis (x402 Flow)

This is the primary revenue-generating service. External agents pay USDC on Base to analyze legal documents.

**Step 1: Discover pricing**

```
GET /api/x402/info
```

Response includes:
- `services[0].pricing.basePrice` — base cost in USDC (default: 1.00)
- `services[0].pricing.pricePerPage` — per-page cost (default: 0.50)
- `paymentDetails.recipient` — address to send USDC to
- `paymentDetails.token` — USDC contract on Base
- `paymentDetails.chainId` — 8453

**Step 2: Send USDC on-chain**

Transfer `basePrice + (pricePerPage * (pageCount - 1))` USDC to the `recipient` address on Base. Record the transaction hash.

**Step 3: Call the analysis endpoint**

```
POST /api/analyze
Headers:
  X-Payment-TxHash: <your_tx_hash>
  X-Page-Count: <number_of_pages>
Content-Type: multipart/form-data

Body:
  files: <PDF file(s)>
  mode: "summarize" | "extract_clauses" | "flag_risks" | "custom"
  customQuery: <string>  (required if mode is "custom")
```

Response: Server-Sent Events (SSE) stream with events:
- `status` — progress updates (`extracting`, `extracted`, `analyzing`, `complete`)
- `chunk` — incremental analysis text from Venice AI
- `error` — error details
- `done` — stream complete

**If no payment is provided**, the endpoint returns HTTP 402 with a payment facilitation body containing all required payment details.

**Each transaction hash is single-use.** A hash cannot be reused for multiple requests.

### 2. Complete API Endpoint Reference

| Method | Path | Auth | Returns |
|--------|------|------|---------|
| `GET` | `/.well-known/agent.json` | Public | ERC-8004 agent manifest |
| `GET` | `/api/healthz` | Public | System health check |
| `GET` | `/api/x402/info` | Public | x402 pricing discovery |
| `POST` | `/api/analyze` | x402 or Admin | Upload PDFs for streaming AI analysis (SSE) |
| `GET` | `/api/payments` | Public | List of recorded payments |
| `GET` | `/api/payments/wallet` | Public | Agent wallet balances (ETH, USDC, VVV, Locus) |
| `GET` | `/api/payments/charges` | Public | List of pending/paid charges |
| `POST` | `/api/payments/charge` | Public | Create a USDC payment charge |
| `GET` | `/api/payments/charge/:id` | Public | Single charge details |
| `POST` | `/api/payments/confirm` | Public | Confirm payment with tx hash |
| `GET` | `/api/payments/delegation` | Public | Delegation status + EIP-712 type definitions |
| `POST` | `/api/payments/delegation` | Public | Submit signed EIP-712 delegation |
| `GET` | `/api/payments/identity` | Public | ERC-8004 registration status and reputation score |
| `POST` | `/api/payments/identity/register` | Admin | Register agent on-chain (requires `Authorization: Bearer <ADMIN_API_TOKEN>`) |
| `GET` | `/api/payments/agent-log` | Public | Structured decision log (all autonomous actions) |
| `GET` | `/api/payments/locus/transactions` | Public | Locus transaction history |
| `POST` | `/api/payments/locus/send` | Admin | Send USDC via Locus (requires `Authorization: Bearer <ADMIN_API_TOKEN>`) |
| `POST` | `/api/payments/swap` | Admin | Trigger Uniswap swap (requires `Authorization: Bearer <ADMIN_API_TOKEN>`) |
| `GET` | `/api/budget` | Public | DIEM compute budget status |
| `GET` | `/api/activity/stream` | Public | SSE live activity stream |
| `POST` | `/api/tasks` | Public | Schedule recurring tasks |

**Auth modes:**
- **Public** — no authentication required
- **x402** — requires `X-Payment-TxHash` header with a valid on-chain USDC payment tx
- **Admin** — requires `Authorization: Bearer <ADMIN_API_TOKEN>` header (used by the frontend proxy)

### 3. Charge-Based Payment Flow

For invoiced payments (alternative to x402):

```
POST /api/payments/charge
Body: { "amount": 5.00, "label": "Client Name" }
→ Returns: { id, amount, status, paymentUrl }
```

Client pays USDC to the agent's Locus wallet or EOA, then confirms:

```
POST /api/payments/confirm
Body: { "txHash": "0x...", "chargeId": "<charge_id>" }
```

### 4. Delegation (ERC-7715)

The agent operates under delegated authority. The owner signs an EIP-712 typed data delegation granting the agent permission to spend USDC autonomously.

```
GET /api/payments/delegation
→ Returns: { active, delegator, dailyLimitUsdc, eip712: { types, domain, primaryType } }
```

```
POST /api/payments/delegation
Body: { delegator, delegate, allowedContract, dailyLimitUsdc, expiresAt, signature }
```

## Autonomous Behaviors

When the agent receives a USDC payment, it autonomously:

1. Records the payment in its internal ledger
2. Notifies the owner via Telegram
3. Calculates 10% commission (5% ETH + 5% VVV)
4. Verifies active EIP-712 delegation from owner
5. Transfers commission from Locus treasury to agent EOA (if Locus-sourced)
6. Executes USDC → ETH swap via Uniswap V3 (gas replenishment)
7. Executes USDC → VVV swap via Uniswap V3 (Venice compute equity)
8. Logs a structured decision record with 5 fields: trigger, plan, execution, verification, outcome
9. Submits reputation feedback on-chain to ERC-8004 ReputationRegistry

All swaps are gated by the delegation — the agent cannot spend more USDC than the owner has authorized per day.

## Structured Decision Records

Every autonomous action produces a decision record accessible via:

```
GET /api/payments/agent-log
```

Each entry contains:
```json
{
  "timestamp": "2026-03-21T...",
  "type": "swap | payment | delegation | registration | reputation",
  "description": "Human-readable summary",
  "txHash": "0x...",
  "amount": "1.00",
  "token": "USDC",
  "decision": {
    "trigger": "What initiated this action",
    "plan": "What the agent intended to do",
    "execution": "What actually happened",
    "verification": "How the result was confirmed",
    "outcome": "Final result summary"
  }
}
```

## DIEM Compute Budget

The agent tracks its own compute consumption in DIEM credits (1 DIEM ≈ $1/day of Venice AI compute).

```
GET /api/budget
```

Response shape:
```json
{
  "categories": {
    "venice": { "used": 3, "limit": 200, "percentUsed": 2, "diemCost": 0.0124 },
    "rpc": { "used": 15, "limit": 5000, "percentUsed": 0, "diemCost": 0 },
    "uniswap": { "used": 0, "limit": 100, "percentUsed": 0, "diemCost": 0 },
    "locus": { "used": 5, "limit": 500, "percentUsed": 1, "diemCost": 0 },
    "telegram": { "used": 2, "limit": 1000, "percentUsed": 0, "diemCost": 0 }
  },
  "overall": { "used": 25, "limit": 6800, "percentUsed": 0 },
  "diem": {
    "consumed": 0.0124,
    "budget": 5.0,
    "percentUsed": 0,
    "unit": "DIEM"
  },
  "lastResetAt": "2026-03-21T00:00:00.000Z",
  "nextResetAt": "2026-03-22T00:00:00.000Z"
}
```

Key fields:
- `diem.consumed` — DIEM used today (0.002 DIEM per 1K tokens for Venice calls)
- `diem.budget` — daily DIEM cap (default 5.0, configurable via `BUDGET_DIEM_DAILY`)
- `diem.percentUsed` — percentage of daily budget consumed
- `nextResetAt` — next midnight UTC reset timestamp
- `categories.<name>.diemCost` — DIEM cost attributed to each category

When the DIEM budget is exhausted (`diem.consumed >= diem.budget`), the agent gracefully refuses Venice AI calls until the daily reset at midnight UTC.

## On-Chain Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| IdentityRegistry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | ERC-8004 agent identity (NFT) |
| ReputationRegistry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | On-chain reputation feedback |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Payment token (6 decimals) |
| VVV | `0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf` | Venice governance token |
| Uniswap Universal Router | `0x6fF5693b99212Da76ad316178A184AB56D299b43` | Swap execution |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | Token approval management |

## Technology Stack

- **AI**: Venice AI (DeepSeek v3.2) — zero-retention inference
- **Backend**: Express + TypeScript (ESM)
- **Blockchain**: viem on Base mainnet (chain 8453)
- **DEX**: Uniswap V3 via Trade API (quote → order → execute)
- **Treasury**: Locus (PayWithLocus API)
- **Identity**: ERC-8004 IdentityRegistry + ReputationRegistry
- **Delegation**: ERC-7715 (EIP-712 typed data signatures)
- **Payments**: x402 (HTTP 402 payment protocol)
- **Communication**: Telegram bot for owner notifications

## Key Design Principles

- **Zero Mocking** — every integration is live on Base mainnet
- **Zero Retention** — documents processed in-memory, buffers zeroed immediately
- **Delegated Authority** — agent cannot exceed owner-authorized daily USDC limits
- **Structured Accountability** — every autonomous decision has a 5-field decision record
- **Compute Budget Awareness** — agent tracks its own DIEM consumption and self-limits
