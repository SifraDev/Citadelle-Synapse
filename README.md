# Venice AI Legal Analysis Platform

**Autonomous AI Legal Agent on Base** — Earns revenue from document analysis, manages its own crypto treasury, and logs every decision on-chain.

![Base](https://img.shields.io/badge/Chain-Base-0052FF?style=flat&logo=coinbase)
![Venice AI](https://img.shields.io/badge/AI-Venice%20(DeepSeek%20v3.2)-7B3FE4?style=flat)
![Locus](https://img.shields.io/badge/Treasury-Locus-00D1A0?style=flat)
![Uniswap](https://img.shields.io/badge/Swaps-Uniswap%20V3-FF007A?style=flat&logo=uniswap)
![ERC-8004](https://img.shields.io/badge/Identity-ERC--8004%20%2334885-F5A623?style=flat)
![x402](https://img.shields.io/badge/Protocol-x402-1DB954?style=flat)
![TypeScript](https://img.shields.io/badge/Built%20with-TypeScript-3178C6?style=flat&logo=typescript)

> **Zero Mocking. Zero Retention. Fully Autonomous.**
>
> Every integration is live on Base mainnet. No mock data, no simulated transactions, no placeholder APIs.

---

## Overview

Venice AI Legal Analysis Platform is an autonomous agent that:

1. **Earns USDC** by analyzing legal documents via Venice AI (DeepSeek v3.2)
2. **Manages its own treasury** via Locus (crypto payment gateway on Base)
3. **Autonomously swaps** earned USDC into ETH (gas) and VVV (Venice governance token) via Uniswap
4. **Logs every autonomous decision** on-chain via ERC-8004 Identity & Reputation registries
5. **Accepts payments** from other agents via the x402 payment protocol (HTTP 402)
6. **Communicates** with its operator via Telegram bot
7. **Tracks compute costs** via DIEM Compute Credits (1 DIEM = $1/day of Venice AI compute)

The agent operates under delegated authority — the owner signs an EIP-712 delegation (ERC-7715) that grants the agent permission to spend USDC autonomously within defined daily limits.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Frontend (React + Vite)                      │
│  Document Vault │ Payments │ Activity Log │ Task Scheduler │ Pay    │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Proxied via ADMIN_API_TOKEN
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     API Server (Express + TypeScript)                │
│                                                                     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│  │ Venice AI│ │  Locus   │ │ Uniswap  │ │ ERC-8004 │ │   x402   │ │
│  │ Analysis │ │ Treasury │ │  Swaps   │ │ Identity │ │ Protocol │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ │
│       │             │            │             │            │       │
│  ┌────┴─────┐ ┌─────┴────┐ ┌────┴─────┐ ┌────┴─────┐ ┌────┴────┐ │
│  │ Budget   │ │ Telegram │ │Delegation│ │ Crypto   │ │  Store  │ │
│  │ Tracker  │ │   Bot    │ │ ERC-7715 │ │ Monitor  │ │  (Mem)  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └─────────┘ │
└─────────────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Base Mainnet (Chain ID: 8453)                    │
│                                                                     │
│  Agent EOA: 0x0128D1EE63C0e99CB3f587E982619bC8B00Ad443              │
│  USDC:      0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913              │
│  VVV:       0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf              │
│  Identity:  0x8004A169FB4a3325136EB29fA0ceB6D2e539a432 (ID #34885)  │
│  Reputation:0x8004BAa17C55a88189AE136b182e5fdA19dE9b63              │
│  Uniswap:   0x6fF5693b99212Da76ad316178A184AB56D299b43              │
│  Permit2:   0x000000000022D473030F116dDEE9F6B43aC78BA3              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Hackathon Prize Targets

| Prize | Amount | How We Qualify |
|-------|--------|----------------|
| **Venice AI** | $11,500 | Core AI engine — all document analysis powered by Venice's DeepSeek v3.2, DIEM compute credit tracking, VVV governance token acquisition |
| **Synthesis** | $25,000 | Full autonomous agent: earns revenue, manages treasury, makes financial decisions, logs structured decisions |
| **ERC-8004 / Protocol Labs** | $8,000 | On-chain agent identity (#34885), structured decision records (trigger/plan/execution/verification/outcome), reputation feedback |
| **Uniswap** | $5,000 | Autonomous USDC→ETH and USDC→VVV swaps via Universal Router, Permit2, quote/order API |
| **Base Agent Services (x402)** | $5,000 | HTTP 402 payment protocol — external agents pay USDC on-chain to access analysis API |
| **Locus** | $3,000 | Locus treasury management, transaction monitoring, commission pipeline, auto-send |

---

## Features

### Venice AI Document Analysis
- **Zero-retention processing** — PDFs parsed in-memory, purged immediately after analysis
- **4 analysis modes**: Summarize, Extract Clauses, Flag Risks, Custom Query
- **Real-time streaming** — analysis streamed via SSE as Venice AI generates tokens
- **Safe Draft generation** — PII-redacted PDF output via secondary Venice AI sanitization pass
- **Model**: `deepseek-v3.2` via Venice AI API

### Autonomous Treasury Management
- **Locus integration** — USDC treasury with real-time balance tracking and transaction monitoring
- **Automatic commission pipeline** — 10% of incoming payments automatically split:
  - 5% → ETH (gas replenishment via Uniswap)
  - 5% → VVV (Venice compute equity via Uniswap)
- **Delegation-gated** — swaps only execute with a valid EIP-712 delegation signature

### Uniswap Autonomous Swaps
- **USDC → ETH** swaps for gas replenishment on Base
- **USDC → VVV** swaps for Venice governance token acquisition
- **Permit2** approval management for efficient token approvals
- **Universal Router** via Uniswap Trade API (quote → order flow)
- **Fallback**: Direct transaction execution if order API returns `methodParameters`

### ERC-7715 Delegation
- **EIP-712 typed data** delegation from owner to agent
- **Daily USDC spending limits** enforced per-swap
- **Expiration-based** — delegations have a defined validity window
- **Dashboard UI** — owner signs delegation directly from the Payments page via MetaMask

### ERC-8004 On-Chain Identity
- **Agent ID #34885** registered on Base IdentityRegistry
- **`.well-known/agent.json`** manifest with capabilities, x402 pricing, compute budget
- **Structured Decision Records** for every autonomous action:
  - `trigger` — what initiated the action
  - `plan` — what the agent intended to do
  - `execution` — what actually happened
  - `verification` — how the result was confirmed
  - `outcome` — final result summary
- **Reputation feedback** submitted on-chain after each action

### x402 Payment Protocol
- **HTTP 402** response with payment facilitation body for unauthenticated requests
- **Pricing**: $1.00 base + $0.50/page (configurable)
- **Payment flow**: Caller sends USDC on-chain → includes `X-Payment-TxHash` header → gets analysis
- **Single-use**: Each transaction hash can only be consumed once
- **Discovery**: `GET /api/x402/info` returns pricing and payment details

### DIEM Compute Budget Tracker
- **1 DIEM = $1/day of Venice AI compute**
- **Token-based pricing**: 0.002 DIEM per 1K tokens (prompt + completion)
- **Daily budget**: 5.0 DIEM (configurable via `BUDGET_DIEM_DAILY`)
- **Midnight UTC reset** — budget resets daily
- **Per-category tracking**: Venice, RPC, Uniswap, Locus, Telegram
- **Graceful denial** — Venice calls refused when DIEM budget exhausted

### Telegram Bot
- **Owner commands**: `/balance`, `/gas`, `/charge`, `/swap`, `/send`, `/identity`, `/preset`
- **Client auto-invoicing** — preset rules auto-generate charges based on keywords
- **Price negotiation** — forwards unknown client inquiries to owner for custom pricing
- **Budget-gated** — all bot messages go through `budgetedSend()` enforcing call limits

### Frontend Dashboard
- **Document Vault** — drag-and-drop PDF upload with real-time streaming analysis
- **Payments** — wallet balances (ETH, USDC, VVV, Locus), delegation center, ERC-8004 identity card, DIEM budget visualization
- **Activity Log** — terminal-style live event stream
- **Task Scheduler** — recurring automated legal workflows
- **Pay Page** — customer-facing checkout at `/pay/:id` with MetaMask integration

---

## On-Chain Identity

| Field | Value |
|-------|-------|
| Agent ID | `#34885` |
| Agent EOA | `0x0128D1EE63C0e99CB3f587E982619bC8B00Ad443` |
| Identity Registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Reputation Registry | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| Chain | Base (8453) |
| Manifest | `/.well-known/agent.json` |

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/x402/info` | Public | x402 pricing discovery |
| `POST` | `/api/analyze` | x402 / Admin | Upload PDFs for streaming AI analysis |
| `POST` | `/api/draft` | Admin | Generate PII-sanitized safe draft PDF |
| `GET` | `/api/payments` | Public | List recorded payments |
| `GET` | `/api/payments/wallet` | Public | Agent wallet balances (ETH, USDC, VVV, Locus) |
| `POST` | `/api/payments/charge` | Public | Create a USDC payment charge |
| `GET` | `/api/payments/charge/:id` | Public | Get charge details |
| `POST` | `/api/payments/confirm` | Public | Confirm payment with tx hash |
| `POST` | `/api/payments/swap` | Admin | Trigger Uniswap swap |
| `GET` | `/api/payments/delegation` | Public | Get delegation status + EIP-712 types |
| `POST` | `/api/payments/delegation` | Public | Submit signed EIP-712 delegation |
| `GET` | `/api/payments/identity` | Public | ERC-8004 registration status |
| `POST` | `/api/payments/identity/register` | Admin | Register agent on-chain |
| `GET` | `/api/payments/agent-log` | Public | Structured decision log |
| `GET` | `/api/budget` | Public | DIEM compute budget status |
| `GET` | `/api/activity/stream` | Public | SSE live activity stream |
| `POST` | `/api/tasks` | Public | Schedule recurring tasks |
| `GET` | `/api/healthz` | Public | System health check |
| `GET` | `/.well-known/agent.json` | Public | ERC-8004 agent manifest |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Engine | Venice AI (DeepSeek v3.2) via OpenAI-compatible API |
| Backend | Express + TypeScript (ESM) |
| Frontend | React + Vite + TypeScript |
| Blockchain | viem (Base mainnet RPC) |
| DEX | Uniswap V3 Universal Router + Permit2 |
| Treasury | Locus (PayWithLocus API) |
| Identity | ERC-8004 IdentityRegistry + ReputationRegistry |
| Delegation | ERC-7715 (EIP-712 typed data signatures) |
| Payments | x402 (HTTP 402 payment protocol) |
| Bot | node-telegram-bot-api |
| API Spec | OpenAPI 3.0 + Orval codegen |
| Monorepo | pnpm workspaces |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VENICE_API_KEY` | Yes | Venice AI API key |
| `PRIVATE_KEY` | Yes | Agent EOA private key (Base) |
| `TELEGRAM_BOT_TOKEN` | Yes | Telegram bot token |
| `TELEGRAM_CHAT_ID` | Yes | Owner/CEO Telegram chat ID |
| `ADMIN_API_TOKEN` | Yes | Server-side admin auth token |
| `LOCUS_API_KEY` | No | Locus treasury API key |
| `UNISWAP_API_KEY` | No | Uniswap Trade API key |
| `BUDGET_DIEM_DAILY` | No | Daily DIEM budget (default: 5.0) |
| `BUDGET_LIMIT_VENICE` | No | Max Venice calls/day (default: 200) |
| `BUDGET_LIMIT_RPC` | No | Max RPC calls/day (default: 5000) |
| `BUDGET_LIMIT_UNISWAP` | No | Max Uniswap calls/day (default: 100) |
| `BUDGET_LIMIT_LOCUS` | No | Max Locus calls/day (default: 500) |
| `BUDGET_LIMIT_TELEGRAM` | No | Max Telegram calls/day (default: 1000) |
| `ETH_COMMISSION_RATE` | No | ETH commission rate (default: 0.05) |
| `VVV_COMMISSION_RATE` | No | VVV commission rate (default: 0.05) |
| `MIN_SWAP_THRESHOLD` | No | Min USDC for swap (default: 0.50) |
| `X402_BASE_PRICE` | No | x402 base price in USDC (default: 1.00) |
| `X402_PRICE_PER_PAGE` | No | x402 per-page price (default: 0.50) |

---

## Project Structure

```
workspace/
├── artifacts/
│   ├── api-server/           # Express API server
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── venice.ts       # Venice AI streaming analysis + sanitization
│   │       │   ├── locus.ts        # Locus treasury + transaction monitor
│   │       │   ├── uniswap.ts      # Uniswap V3 swaps (quote/order/execute)
│   │       │   ├── erc8004.ts      # ERC-8004 identity + reputation + decision log
│   │       │   ├── x402.ts         # x402 payment protocol middleware
│   │       │   ├── delegation.ts   # ERC-7715 EIP-712 delegation
│   │       │   ├── crypto.ts       # On-chain balance reads + transfer monitor
│   │       │   ├── budget.ts       # DIEM compute budget tracker
│   │       │   ├── telegram.ts     # Telegram bot + command handler
│   │       │   └── store.ts        # In-memory state (payments, charges, activity)
│   │       └── routes/
│   │           ├── analysis.ts     # /api/analyze, /api/draft, /api/x402/info
│   │           └── payments.ts     # /api/payments/*, /api/budget
│   └── web/                  # React + Vite frontend
│       └── src/
│           └── pages/
│               ├── DocumentVault.tsx
│               ├── Payments.tsx
│               ├── ActivityLog.tsx
│               ├── TaskScheduler.tsx
│               └── PayPage.tsx
├── lib/
│   └── api-spec/
│       ├── openapi.yaml      # OpenAPI 3.0 specification
│       └── generated/        # Orval-generated API client + Zod schemas
└── package.json
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- pnpm 9+

### Installation

```bash
pnpm install
```

### Configuration

Set the required environment variables (see table above). At minimum:

```bash
export VENICE_API_KEY=your_venice_key
export PRIVATE_KEY=your_agent_private_key
export TELEGRAM_BOT_TOKEN=your_bot_token
export TELEGRAM_CHAT_ID=your_chat_id
export ADMIN_API_TOKEN=your_admin_token
```

### Run

```bash
# Start both API server and frontend
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/web run dev
```

The API server starts on port 8080 and the frontend on its assigned port.

### Codegen

After modifying `lib/api-spec/openapi.yaml`:

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Autonomous Agent Behavior

When the agent receives a USDC payment (via Locus monitor, direct transfer monitor, or x402):

1. **Payment recorded** in the in-memory store
2. **Telegram notification** sent to the owner
3. **Commission calculated** (5% ETH + 5% VVV)
4. **Delegation verified** — checks for valid EIP-712 signature with sufficient daily limit
5. **Commission transferred** from Locus treasury to agent EOA (if via Locus)
6. **USDC → ETH swap** executed via Uniswap (for gas)
7. **USDC → VVV swap** executed via Uniswap (for compute equity)
8. **Decision record** logged with trigger/plan/execution/verification/outcome
9. **Reputation feedback** submitted on-chain to ERC-8004 ReputationRegistry

All of the above happens autonomously. The owner controls limits via delegation signatures.

---

## Key Design Principles

- **Zero Retention** — Documents processed in-memory, buffers zeroed and arrays cleared immediately after analysis
- **Zero Mocking** — Every integration is live: Venice AI, Locus, Uniswap, ERC-8004, Base mainnet
- **Delegated Authority** — Agent cannot spend more than the owner authorizes via EIP-712
- **Compute Budget Awareness** — Agent tracks its own resource consumption in DIEM credits
- **Structured Accountability** — Every autonomous decision has a 5-field decision record logged on-chain
- **Privacy First** — Safe Draft feature redacts all PII before external distribution

---

## Links & References

- [Venice AI](https://venice.ai) — Privacy-focused AI inference
- [Locus](https://paywithlocus.com) — Crypto payment infrastructure
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) — Agent Identity standard
- [ERC-7715](https://eips.ethereum.org/EIPS/eip-7715) — Delegation framework
- [x402 Protocol](https://www.x402.org/) — HTTP 402 payment protocol
- [Uniswap Trade API](https://docs.uniswap.org/api/trading) — Swap routing and execution
- [Base](https://base.org) — Ethereum L2

---

## License

MIT
