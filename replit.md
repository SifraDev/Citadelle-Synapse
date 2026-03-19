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
- `payments: PaymentEntry[]` — crypto payment logs from Telegram bot

### Telegram Bot (artifacts/api-server/src/lib/telegram.ts)
- Runs in the same Express process (not a separate service)
- Uses polling mode with 409 Conflict protection (stops polling on conflict)
- All outgoing messages are logged to the activity store via `logOutgoing()` helper
- CEO vs client routing based on TELEGRAM_CHAT_ID comparison
- Supports /preset rules for auto-pricing, client quote flow, and payment buttons

### Venice AI (artifacts/api-server/src/lib/venice.ts)
- Uses OpenAI SDK pointed at `https://api.venice.ai/api/v1`
- Model: `deepseek-r1-671b`
- Supports 4 analysis modes: summarize, extract_clauses, flag_risks, custom
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
│   │       │   └── telegram.ts   # Telegram bot (in-process)
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

## API Endpoints

- `GET /api/healthz` — Health check
- `POST /api/analyze` — Upload PDFs + stream analysis (multipart/form-data, SSE response)
- `GET /api/tasks` — List scheduled tasks
- `POST /api/tasks` — Create scheduled task
- `DELETE /api/tasks/:id` — Delete scheduled task
- `GET /api/activity` — Get activity log entries
- `GET /api/activity/stream` — SSE stream for live activity
- `GET /api/telegram/status` — Telegram bot connection status
- `POST /api/telegram/send` — Send message via Telegram bot
- `GET /api/payments` — Get crypto payment logs

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API client hooks and Zod schemas
