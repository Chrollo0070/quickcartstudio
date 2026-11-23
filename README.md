# QuickCart

**Supermarket self-checkout, POS and real-time inventory platform.**

Customers scan product barcodes, build a cart, pay and get a digital receipt —
while staff POS, inventory and dashboards work off **one pricing engine, one
order domain and one stock ledger**. This repo is a production-minded modular
monolith (NestJS + Next.js + PostgreSQL) built phase by phase; see
[docs/implementation-status.md](docs/implementation-status.md) for the exact
state.

## Stack

|          |                                                                                                      |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Frontend | Next.js 16 (App Router) · React 19 · Tailwind CSS 4 · TanStack Query · Zod                           |
| Backend  | NestJS 12 (modular monolith) · REST `/api/v1` · Swagger · Socket.IO (Phase 4) · BullMQ (Phase 3+)    |
| Data     | PostgreSQL 17 · Prisma 7 (driver adapters, Decimal money) · Redis 7 (Phase 3+)                       |
| Quality  | ESLint 9 · Prettier · Jest (API, ESM mode) · Vitest (shared) · Playwright (Phase 6) · GitHub Actions |
| Infra    | Docker Compose (Postgres + Redis) · Turborepo · pnpm workspaces                                      |

Docs: [architecture](docs/architecture.md) ·
[ER diagram](docs/er-diagram.md) ·
[state transitions](docs/order-state-transitions.md) ·
[API guidelines](docs/api-guidelines.md) ·
[ADRs](docs/decisions/).

## Prerequisites

- Node.js **≥ 22.12** (22 LTS used in development/CI)
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- One of:
  - **Docker** (recommended) — for Postgres + Redis via Compose, **or**
  - **nothing else** — use the built-in embedded dev Postgres fallback (no Docker
    needed; Redis is only required from Phase 3).

## Quick start

```bash
# 1. Install
pnpm install

# 2. Environment (set JWT_ACCESS_SECRET — e.g. openssl rand -base64 48)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# 3. Database — pick ONE:
pnpm db:up                       # (a) Docker Compose: Postgres :5432 + Redis :6379
pnpm db:embedded:up              # (b) No Docker: embedded Postgres on :5433
#    For (b), switch DATABASE_URL in apps/api/.env to the :5433 line
#    documented in apps/api/.env.example.

# 4. Migrate + seed
pnpm db:migrate
pnpm db:seed

# 5. Run (two terminals or `pnpm dev` for both)
pnpm --filter @quickcart/api dev      # API  → http://localhost:4000
pnpm --filter @quickcart/web dev      # Web  → http://localhost:3000
```

Then:

- Web landing page: <http://localhost:3000>
- API health: <http://localhost:4000/api/v1/health>
- Swagger UI: <http://localhost:4000/api/v1/docs>

### All commands

| Command                                      | What it does                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                                   | Run API + web concurrently (watch mode).                               |
| `pnpm build` / `lint` / `typecheck` / `test` | Full workspace via Turborepo.                                          |
| `pnpm format` / `format:check`               | Prettier write/check.                                                  |
| `pnpm db:up` / `db:down`                     | Docker Compose Postgres + Redis.                                       |
| `pnpm db:embedded:up` / `:down` / `status`   | Embedded dev Postgres (no Docker), port 5433, data in `infra/.pgdata`. |
| `pnpm db:migrate`                            | `prisma migrate deploy` (apps/api).                                    |
| `pnpm db:seed`                               | Idempotent QuickMart seed (36 products, users, batches, POs, coupons). |
| `pnpm db:generate`                           | Regenerate the Prisma client (also runs on build).                     |

## Demo data & credentials (development only)

Seeded store: **QuickMart Panaji** (`QM-PAN`, Panaji/GA — GST context).
Password for all seeded staff accounts: **`QuickMart!dev123`**

| Role            | Email                     |
| --------------- | ------------------------- |
| Admin / owner   | `admin@quickmart.dev`     |
| Store manager   | `manager@quickmart.dev`   |
| Cashier         | `cashier@quickmart.dev`   |
| Inventory staff | `inventory@quickmart.dev` |

Extras: 3 customers with loyalty balances, coupons `WELCOME10` and `SAVE25`,
low-stock items (Amul Milk 500 ml, Egg Tray, Lay's), near-expiry batches (milk,
dahi, bread, paneer), a completed goods receipt with `PURCHASE_RECEIPT` ledger
entries and an open cashier shift. The seed is **idempotent** — safe to re-run.

Demo barcodes for scanner testing: milk `8900100000424`, bread `8900100000844`,
Parle-G `8900100001964`.

## Testing

```bash
pnpm test                 # everything (turbo)
pnpm --filter @quickcart/api test        # Jest (ESM mode; see ADR-006)
pnpm --filter @quickcart/shared test     # Vitest
```

Phase 0 ships 20 meaningful unit tests (money/rounding math, env validation,
Zod validation pipe). Integration tests (checkout lifecycle, duplicate webhooks,
concurrent checkout, atomic decrement) arrive with their phases — the plan is in
[implementation-status.md](docs/implementation-status.md).

## Deployment (target shape)

- Frontend → Vercel/Next.js host. Backend → container host (Render/Railway/Fly).
- Database → managed PostgreSQL; Redis → managed Redis. `prisma migrate deploy`
  in the release pipeline.
- The app stays runnable via Docker Compose for local development.
- Detailed deployment guide lands in Phase 6.

## Known limitations

See [docs/implementation-status.md → Known issues](docs/implementation-status.md#known-issues--limitations-phase-0).
Notably: payment flows are mock/test-mode only; GST configuration requires
review by a qualified accountant before any commercial use; no raw card data is
ever collected or stored.
