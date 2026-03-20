# Workspace

## Overview

Venice AI Legal Platform — a zero-retention document analysis platform for lawyers. Built with React + Vite frontend and Express 5 backend in a pnpm workspace monorepo.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React 19, Vite 7, Tailwind CSS 4, Wouter, TanStack React Query, Framer Motion, react-dropzone
- **API framework**: Express 5
- **AI**: Venice AI (OpenAI-compatible API via `openai` SDK)
- **Telegram**: node-telegram-bot-api (in-process, polling mode)
- **PDF parsing**: pdf-parse (in-memory only)
- **Blockchain**: viem (Base mainnet, USDC ERC-20 interactions)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Architecture

### Zero-Retention Policy
- No persistent database is used for document data
- PDFs are uploaded via multer memoryStorage, text extracted, analyzed by Venice AI, then buffers are zeroed out
- Activity logs, scheduled tasks, and payment entries are kept in-memory (Maps/Arrays) and lost on restart
- The database package (`@workspace/db`) exists in the workspace but is NOT used by this application

### In-Memory Data Stores (artifacts/api-server/src/lib/store.ts)
- `tasks: Map<string, ScheduledTask>` — scheduled tasks with actionType (analyze_document, send_reminder, charge_client, report_messages)
- `activityLog: ActivityEntry[]` — capped at 500 entries, SSE-broadcast to connected clients
- `payments: PaymentEntry[]` — blockchain payment records with txHash, from/to, amount, status
- `charges: Map<string, ChargeRequest>` — USDC charge requests (amount, label, status, paidAt, txHash)

### Crypto / Base Chain (artifacts/api-server/src/lib/crypto.ts)
- Uses `viem` to interact with Base mainnet (chain ID 8453)
- Agent wallet: 0x0128D1EE63C0e99CB3f587E982619bC8B00Ad443
- USDC contract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (6 decimals)
- Reads real USDC balance via `balanceOf` on-chain call
- Background poller watches USDC Transfer events to agent wallet every 15s
- Detected payments auto-match against open charges, update status, log activity, and send Telegram notifications
- `verifyTransaction(txHash, recipientAddress?)` validates against either agent wallet or Locus wallet

### Locus Payment Infrastructure (artifacts/api-server/src/lib/locus.ts)
- Locus API: `https://beta-api.paywithlocus.com/api` (LOCUS_API_KEY + LOCUS_PRIVATE_KEY in secrets)
- Locus wallet: dynamically fetched via `GET /api/pay/balance` (currently 0xa1dea7...713c)
- Functions: getLocusBalance (10s cache), getLocusTransactions, locusSendPayment, locusHealthCheck, getLocusWalletAddress, startLocusMonitor
- Monitor: 20s polling via `GET /api/pay/transactions`, auto-matches incoming USDC against pending charges
- On confirmed incoming payment: if Uniswap configured, calculates 10% commission, sends via Locus to agent EOA, triggers autonomous USDC→ETH swap
- All charges default to Locus wallet as payment target; payments carry `paymentMethod: "direct" | "locus" | "swap"`
- `/payments/locus/send` is auth-guarded (requires ADMIN_API_TOKEN)

### Uniswap Trading API (artifacts/api-server/src/lib/uniswap.ts)
- Uniswap Trading API: `https://trade-api.gateway.uniswap.org/v1` (UNISWAP_API_KEY in secrets)
- Swaps USDC→native ETH on Base mainnet via Universal Router
- Functions: getSwapQuote, ensurePermit2Approval, executeSwap, performAutonomousSwap, calculateCommission
- Permit2 address: 0x000000000022D473030F116dDEE9F6B43aC78BA3
- Commission rate: 10% of incoming payments, minimum threshold: 0.50 USDC
- All swaps check delegation before executing; denied swaps logged as "Permission Required"
- Supports both order-based and direct-tx execution paths

### MetaMask Delegation (ERC-7715) (artifacts/api-server/src/lib/delegation.ts)
- EIP-712 typed data delegation: owner signs permission for agent to swap up to dailyLimitUsdc/day
- Domain: "Venice AI Legal Platform", version "1", chainId 8453 (Base)
- In-memory storage (zero-retention — owner must re-sign after server restart)
- Verification: checks signature via ecrecover, expiry, and daily cumulative usage
- Graceful denial: logs "Permission Required", notifies via Telegram, does NOT error

### Telegram Bot (artifacts/api-server/src/lib/telegram.ts)
- Runs in the same Express process (not a separate service)
- Uses polling mode with 409 Conflict protection (stops polling on conflict)
- All outgoing messages are logged to the activity store via `logOutgoing()` helper
- CEO vs client routing based on TELEGRAM_CHAT_ID comparison
- Supports /preset rules for auto-pricing, client quote flow, and payment buttons
- Supports /charge command for CEO to create USDC charges via Telegram
- Supports /gas command — shows agent ETH balance + delegation status
- Supports /swap <amount> command — CEO-only, triggers USDC→ETH swap (checks delegation)
- Supports /send <address> <amount> <memo> — send USDC via Locus

### Venice AI (artifacts/api-server/src/lib/venice.ts)
- Uses OpenAI SDK pointed at `https://api.venice.ai/api/v1`
- Model: `deepseek-v3.2`
- Supports 4 analysis modes: summarize, extract_clauses, flag_risks, custom
- Sanitization mode: rewrites analysis to redact all PII (names, addresses, amounts, dates, case numbers)
- PDF draft generation via pdfkit (in-memory, zero-retention)
- Streams responses via SSE to frontend

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server (backend)
│   │   └── src/
│   │       ├── lib/
│   │       │   ├── store.ts      # In-memory data stores
│   │       │   ├── venice.ts     # Venice AI client
│   │       │   ├── telegram.ts   # Telegram bot (in-process)
│   │       │   ├── crypto.ts    # Base chain interactions (viem)
│   │       │   ├── locus.ts     # Locus payment API client
│   │       │   ├── uniswap.ts   # Uniswap Trading API client
│   │       │   └── delegation.ts # EIP-712 delegation system
│   │       └── routes/
│   │           ├── analysis.ts   # PDF upload + SSE streaming analysis
│   │           ├── tasks.ts      # CRUD for scheduled tasks
│   │           ├── activity.ts   # Activity logs + SSE stream
│   │           ├── telegram.ts   # Telegram status + send message
│   │           └── payments.ts   # Crypto payment log listing
│   └── web/                # React + Vite frontend
│       └── src/
│           ├── pages/
│           │   ├── Vault.tsx       # Document upload + live analysis
│           │   ├── Scheduler.tsx   # Task scheduler CRUD
│           │   ├── Activity.tsx    # Real-time activity log
│           │   └── Payments.tsx    # Crypto payment dashboard
│           ├── components/layout/
│           │   ├── Sidebar.tsx     # Navigation + Telegram status
│           │   └── Layout.tsx      # App shell with SSE listeners
│           └── hooks/
│               ├── use-analyze-stream.ts   # SSE hook for analysis
│               └── use-activity-stream.ts  # SSE hook for activity feed
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM (exists but NOT used)
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Environment Variables (Secrets)

- `VENICE_API_KEY` — Venice AI API key
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `TELEGRAM_CHAT_ID` — Default Telegram chat ID for alerts
- `PRIVATE_KEY` — Agent EOA wallet private key (for signing Permit2/Uniswap txs)
- `UNISWAP_API_KEY` — Uniswap Trading API key
- `LOCUS_API_KEY` — Locus payment API key
- `LOCUS_PRIVATE_KEY` — Locus private key
- `ADMIN_API_TOKEN` — Admin token for auth-guarded endpoints

## API Endpoints

- `GET /api/healthz` — Health check
- `POST /api/analyze` — Upload PDFs + stream analysis (multipart/form-data, SSE response)
- `POST /api/draft` — Generate sanitized PDF draft from analysis text (PII redacted via Venice AI, zero-retention)
- `GET /api/tasks` — List scheduled tasks
- `POST /api/tasks` — Create scheduled task
- `DELETE /api/tasks/:id` — Delete scheduled task
- `GET /api/activity` — Get activity log entries
- `GET /api/activity/stream` — SSE stream for live activity
- `GET /api/telegram/status` — Telegram bot connection status
- `POST /api/telegram/send` — Send message via Telegram bot
- `GET /api/payments` — Get crypto payment logs
- `GET /api/payments/wallet` — Agent wallet + Locus treasury info + real USDC balance (on-chain)
- `GET /api/payments/charges` — List all charge requests
- `POST /api/payments/charge` — Create USDC charge request (auto-sets Locus wallet)
- `GET /api/payments/charge/:id` — Get charge details (with wallet/contract info, paymentMethod)
- `POST /api/payments/confirm` — Confirm payment with transaction hash (Locus-aware verification)
- `DELETE /api/payments/charge/:id` — Cancel/expire a pending charge
- `GET /api/payments/locus/transactions` — Locus transaction history
- `POST /api/payments/locus/send` — Send USDC via Locus (auth-guarded)
- `GET /api/payments/delegation` — Get current delegation status + EIP-712 type info
- `POST /api/payments/delegation` — Submit signed EIP-712 delegation
- `POST /api/payments/swap` — Manually trigger USDC→ETH swap via Uniswap (auth-guarded, checks delegation)

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client hooks and Zod schemas
