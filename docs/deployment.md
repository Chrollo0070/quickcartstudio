# Deployment Guide

## Target shape (spec §2)

| Component     | Host                        | Notes                                                                                       |
| ------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| Web (Next.js) | Vercel                      | `apps/web` root; set `NEXT_PUBLIC_API_URL` to the API origin.                               |
| API (NestJS)  | Render / Railway / Fly.io   | Docker or Node build from `apps/api`; health check `GET /api/v1/health` (503 when DB down). |
| PostgreSQL    | managed (Neon/Supabase/RDS) | Prisma 7 driver adapter; enable `sslmode=require`.                                          |
| Redis         | managed                     | Required for BullMQ queues + shared rate limiting (Phase 6 schedulers).                     |

## Environment (production)

- `DATABASE_URL` — managed Postgres with `?sslmode=require`.
- `REDIS_URL` — managed Redis (queues, scheduler, shared limiter).
- `JWT_ACCESS_SECRET`, `PAYMENT_WEBHOOK_SECRET` — 48+ random bytes
  (`openssl rand -base64 48`), rotated via the platform's secret store.
- `CORS_ORIGINS` — the web origin(s) exactly; no wildcards with credentials.
- `NODE_ENV=production` — enables `secure` cookies + reduced log verbosity.
- `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET` — test mode first, then live.

## Release pipeline

1. CI green (format/lint/typecheck/test/build + E2E against a service
   Postgres — see `.github/workflows/ci.yml`).
2. `prisma migrate deploy` against the production database (migrations are
   forward-only; never edit an applied migration).
3. Deploy API (container) → verify `/api/v1/health` readiness gate.
4. Deploy web → smoke: sign in, one POS sale, receipt, refund approval.

## Database operations

- **Migrations:** forward-only `migrate deploy`; generate with
  `prisma migrate dev` against a shadow database.
- **Backups:** managed PITR + nightly logical dump; restore drill quarterly
  (restore into a scratch DB and run the E2E suite against it).
- **Ledger caution:** `StockMovement` / `LoyaltyLedgerEntry` / `AuditLog` /
  `OrderItem` are append-only by contract — never UPDATE/DELETE; corrections
  are new rows.

## Schedulers (needs Redis)

- Reservation reaper: expire `ACTIVE` reservations past TTL (releases stock).
- Loyalty expiry: `EXPIRY` entries for earned points past `expiresAt`.
- Receipt email/export jobs (BullMQ).

## Local verification without Docker

`pnpm db:embedded:up` runs a managed-lifecycle Postgres 18 on :5433
(UTF-8 forced — see `infra/scripts/dev-postgres.mjs`). Docker Compose remains
the canonical path where Docker exists.
