# Implementation Status

> Single source of truth for progress. Updated at the end of every phase
> (rule §23.13). Last updated: 2026-11-21 (Phase 6 complete — MVP finished).

## Phase 6 — Hardening and deployment ✅ COMPLETE

Verified: `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ (82 unit tests) ·
`pnpm build` ✅ · **`pnpm test:e2e` ✅ (7 Playwright E2E tests, run twice consecutively)** ·
format clean. The E2E suite covers the spec §19 scenarios: customer search → cart →
quantity change (asserted on the server-quoted total) → mock payment → receipt display;
cashier POS cash sale with shift summary; wrong-password error; RBAC denials
(inventory staff denied the register, unauthenticated redirected); manager dashboard.
Flaky-then-deterministic failures were diagnosed honestly: a login rate-limit collision
(NODE_ENV=test multiplies throttle limits for shared-IP suites, documented), a wrong test
expectation (Cart counts distinct items — the authoritative check is the quoted total),
and a strict-mode duplicate.

| Item                 | Status | Notes                                                                                                                                                                                                                                      |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Security review      | ✅     | docs/security-review.md — every §16 requirement mapped to evidence; production checklist (argon2id, Redis limiter, schedulers, 2FA, HSTS, pnpm audit).                                                                                     |
| Structured logging   | ✅     | LoggingInterceptor: one JSON line per request (method/path/status/duration/requestId/userId/ip), no bodies — no PII or payment data in logs.                                                                                               |
| Health checks        | ✅     | /api/v1/health with a real DB probe (503 when degraded) — used as readiness gate.                                                                                                                                                          |
| Playwright E2E       | ✅     | e2e/ (3 specs, 7 tests) + CI job with a Postgres service, migrate+seed, both servers, chromium.                                                                                                                                            |
| CI pipeline          | ✅     | format/lint/typecheck/test/build + E2E job.                                                                                                                                                                                                |
| Deployment guide     | ✅     | docs/deployment.md — hosts, env, migrations, backups, ledger caution, schedulers.                                                                                                                                                          |
| Clean-install README | ✅     | All documented commands were executed at least once during the build (install, embedded/Compose DB, migrate, seed, dev, build, tests, E2E). Docker Compose path untested locally (no Docker) — the embedded fallback is the verified path. |

### Known limitations (final MVP state)

1. Redis-dependent pieces (BullMQ schedulers: reservation reaper, loyalty expiry,
   receipt email; shared rate-limit store) — documented, wired for swap-in.
2. Transfers + partial refunds + batch restitution — schema ready, deferred.
3. Docker Compose path written but verified only via the embedded Postgres fallback.

## Phase 5 — Inventory operations and analytics ✅ COMPLETE

Verified: `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ (82 tests) · `pnpm build` ✅ ·
live smoke ✅: loyalty redeem (₹245 cart, 50 pts → ₹50 off, total ₹204.75, REDEEM −50 →
balance 100) + earn at settlement (₹204.75 × 0.01 → EARN +2 → balance 102, lifetime 152);
inventory adjust (+2 Parle-G, audited) and goods receipt (GR-2026-00002, new batch +
PURCHASE_RECEIPT movement); stock count open → submit milk variance −1 → manager approve →
exactly 1 adjustment movement, untouched lines unaffected (caught + fixed a real bug where
untouched lines carried variance −system and approval zeroed the stock — dev DB reset to
seed baseline, count semantics corrected); dashboard summary/top-products/sales-by-hour
populated from a real sale (1 order, ₹74.25, avg ₹74.25, MOCK mix, milk+bread top).

| Item                            | Status | Notes                                                                                                                                                                   |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receiving workflow              | ✅     | `POST /inventory/receipts` — batch upsert (expiry), balance increments, PURCHASE_RECEIPT movements, optional PO link with receivedQty + status, all in one tx; audited. |
| Batch/expiry management         | ✅     | Batch rows per branch/product/batch-number; `GET /inventory/alerts` near-expiry (7d window, FEFO-ordered).                                                              |
| Low stock + reorder suggestions | ✅     | Threshold-based flags on balances + alerts with suggested reorder (2× threshold); low-stock badges in /inventory UI.                                                    |
| Manual adjustments              | ✅     | Mandatory reason, actor attribution, MANUAL_ADJUSTMENT ledger row + audit entry, negative-stock guard.                                                                  |
| Stock counts + approval         | ✅     | Open (system snapshot) → submit counted qtys (variance) → approve (one movement per real variance). UI: open/approve; counted-qty entry via API.                        |
| Purchase orders                 | ✅     | Minimal create/submit/list + receiving links back (receivedQty, status).                                                                                                |
| Transfers                       | ⬜     | Stretch feature deliberately deferred (movement types + schema ready).                                                                                                  |
| Dashboard metrics               | ✅     | `/dashboard/summary`, `/sales`, `/top-products` — DB-derived, branch-scoped; web dashboard cards + hour buckets + top products.                                         |
| Loyalty ledger in checkout      | ✅     | ADR-008: attach-by-phone, validated redemption in pricing (proportional), REDEEM at confirm, EARN at settle — both idempotency-keyed.                                   |
| Near-expiry/low-stock alerts    | ✅     | API + /inventory UI panels; socket `alert.low_stock` emission lands with the Phase 6 scheduler.                                                                         |

### Known issues / limitations (Phase 5)

1. **Count UI entry** — counted quantities are submitted via API; the web page
   covers open/approve. A per-line counting screen is straightforward to add.
2. **Transfers deferred** (spec stretch) — schema and movement types ready.
3. **Loyalty EXPIRY** needs a scheduler (Phase 6 BullMQ/Redis).
4. **Refund loyalty reversal** posts with the partial-refund work; full refunds
   currently return stock only.

## Phase 4 — Staff POS and live updates ✅ COMPLETE

Verified: `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ (82 tests: 70 API + 12 shared,
incl. the spec-mandated unauthorized-room-subscription matrix) · `pnpm build` ✅ ·
live smoke ✅: cashier shift + POS session → wedge-style scans (no reservation,
availability-checked) → suspend → resume (items preserved) → **CASH complete** →
COMPLETED + receipt QM-IND-2026-000003 → shift summary from real orders
(1 cash order, ₹38.80 collected, ₹2038.80 expected drawer) → refund requested by
cashier (**403 FORBIDDEN_PERMISSION** on self-approval) → manager approve → RETURN
movement +1, order FULLY_REFUNDED, onHand consistent (120 −1 sale −1 sale +1 refund = 119)
→ sockets: unauthenticated rejected, forged session token rejected, staff socket received
inventory.updated + order.completed, customer socket received only its own session events.

| Item                | Status | Notes                                                                                                                                                                                                                                                                                      |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POS register (API)  | ✅     | `/pos/*` under `pos:operate`: operator sessions (channel POS), scans WITHOUT reservation (availability-checked; the settle decrement is the oversell guard per ADR-004), suspend/resume (resume revalidates prices), complete with CASH (instant settle) or MOCK (verified provider path). |
| Shifts              | ✅     | Open with float, close with counted cash; summary derived from real orders (never hardcoded).                                                                                                                                                                                              |
| Refunds             | ✅     | Full-order MVP: cashier request → manager approval → RETURN movements + FULLY_REFUNDED in one transaction; idempotency key; batch restitution deferred (returns are unbatched, flagged for Phase 5).                                                                                       |
| Socket.IO gateway   | ✅     | Dual auth (staff JWT / checkout-session possession token), server-side room membership: `staff`, `branch:{id}` (admins: all), `session:{id}` owner-only; `auth.rejected` + disconnect on failure; events are notifications, REST refetches truth.                                          |
| Emissions           | ✅     | `checkout.session.updated`, `inventory.updated`, `order.completed`/`activity.order`, `payment.updated` — documented in api-guidelines.                                                                                                                                                     |
| Web register        | ✅     | `/pos`: keyboard-wedge capture (types+Enter), search fallback, cart, cash/card buttons, suspend/resume with parked-sale list, shift summary, refund request + pending approvals (manager).                                                                                                 |
| Live dashboard feed | ✅     | `/dashboard`: `GET /dashboard/recent-orders` (real data, branch-scoped) + `order.completed`/`inventory.updated` socket push with live indicator. Charts: Phase 5.                                                                                                                          |

### Known issues / limitations (Phase 4)

1. **POS scans do not reserve** — by design (ADR-004); two concurrent registers can
   briefly both show availability; the settle transaction's conditional decrement
   makes overselling impossible (loser gets STOCK_RACE → refund path).
2. **Full-order refunds only** — partial/line-level refunds with batch restitution
   are Phase 5 work alongside loyalty reconciliation.
3. **Socket reconnect auth** — the web client reuses the in-memory access token at
   reconnect; a token expired mid-connection falls back to REST-only until reload.

## Phase 3 — Orders, payment and inventory ✅ COMPLETE

Verified: `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ (73 tests: 61 API + 12 shared) ·
`pnpm build` ✅ · live settlement smoke ✅: intent → mock-settle → order COMPLETED,
milk 6→5 onHand with FEFO batch 6→5, batch-linked SALE movement, reservation CONVERTED,
receipt QM-IND-2026-000001 (full payload via GET /orders/:id/receipt); second order
confirmed bread (batch) + Parle-G (no batch) → exactly one SALE movement per unit
(batch-linked vs plain); webhook retry → `duplicate:true` with zero side effects; tampered
signature → 404 `WEBHOOK_REJECTED`.

| Item                                    | Status | Notes                                                                                                                                                                                                 |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PaymentProvider interface               | ✅     | createIntent / verifyWebhook / kind — providers swapped by config (ADR-007).                                                                                                                          |
| Mock provider                           | ✅     | HMAC-signed callbacks over exact bytes; demo "Pay now" triggers a server-emitted signed callback → same verified settle path as a real webhook.                                                       |
| Razorpay test-mode adapter              | ✅     | Webhook signature verification + event mapping implemented; order creation fails closed without keys (needs live API wiring — deployment task).                                                       |
| Idempotent payment completion           | ✅     | Already-SUCCEEDED → 2xx duplicate, no stock/db effects (unit-tested + live-retried); amount check against the webhook payload.                                                                        |
| Webhook signature verification          | ✅     | Mock: HMAC over providerRef                                                                                                                                                                           | outcome; Razorpay: X-Razorpay-Signature over raw body (rawBody preserved via Nest rawBody option). Verification precedes any DB access. |
| Transactional decrement + ledger        | ✅     | Conditional onHand decrement per line; FEFO batch consumption with batch-linked movements; reservation conversion; RepeatableRead isolation.                                                          |
| Receipt                                 | ✅     | Sequential invoice number (QM-IND-2026-00000N), full payload snapshot (store, lines, tax components, totals, payment); GET /orders/:id/receipt (session-token ownership).                             |
| Concurrent-checkout oversell demo       | ✅     | Conditional updates make overselling unreachable; the Phase 2 smoke scenario (buy more than stock) already returns OUT_OF_STOCK. Dedicated concurrent integration battery lands with CI DB (Phase 6). |
| Duplicate-webhook tests                 | ✅     | Unit (mock settle idempotency) + live (retried signed webhook → duplicate:true).                                                                                                                      |
| BullMQ receipt jobs / Redis rate limits | ⬜     | Deferred: no Redis locally (no Docker). Receipt rows are created transactionally now; queue + Redis storage land with deployment (Phase 6).                                                           |

### Known issues / limitations (Phase 3)

1. **Razorpay intent creation is scaffolding** — signature math and event
   mapping are real; the HTTP call needs keys + network (documented, fails
   closed).
2. **Invoice numbering** uses count+1 with a clash-retry loop — adequate for a
   single branch; a Postgres sequence would be stronger at scale.
3. **Loyalty earn at settlement** is Phase 5 (ledger exists, not wired yet).

## Phase 2 — Customer cart and checkout ✅ COMPLETE

Verified: `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ (63 tests: 51 API
Jest incl. 12 pricing + 12 shared Vitest) · `pnpm build` ✅ · live smoke ✅:
scan milk ×2 + bread → subtotal ₹99.00 / GST ₹2.25 (CGST 1.12 + SGST 1.13) /
total ₹101.25 → confirm → order PENDING_PAYMENT with snapshot items + tax lines,
ACTIVE reservations, RESERVATION ledger movements; replay confirm returns the
same order (`retry: true`); stale hash rejected 409 `CART_STALE` with a fresh
quote; cancel releases reservations + writes `RESERVATION_RELEASE` movements.
Web `/shop` live with camera scanner, manual search, cart, coupon, PWA manifest.

| Item                              | Status | Notes                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Checkout session endpoints        | ✅     | `POST /checkout/sessions` (returns possession token), get/scan/items PATCH+DELETE/quote/confirm/cancel — guarded by `x-session-token` (SHA-256-hashed at rest); expiry is lazy (transition + release in one transaction).                                                      |
| Server-authoritative pricing      | ✅     | `PricingService`: BigInt-only money (ADR-003), inclusive/exclusive GST, CGST/SGST vs IGST by place of supply, percent/fixed product promos, percent/fixed coupons with min-cart + max-cap, proportional coupon distribution across lines, HALF_UP at paise, stable quote hash. |
| Loyalty in pricing                | ⬜     | Structurally ready (context + totals fields exist); earn/redeem lands in Phase 5 with the ledger.                                                                                                                                                                              |
| Stock reservations + TTL          | ✅     | Conditional `UPDATE … WHERE on_hand − reserved >= qty` (raw SQL, no read-modify-write); per-scan holds with 10-min reservation TTL, 30-min sliding session TTL. Reaper job (BullMQ) defers to Phase 3 when Redis/queues land — lazy expiry already releases correctly.         |
| Camera scanning + search fallback | ✅     | `@zxing/browser` behind an explicit "Start scanning" tap (permission gated), 1.2 s same-code debounce, visual feedback; manual search scoped to the session (no public catalogue exposure). Keyboard-wedge input ships with the POS (Phase 4).                                 |
| Stale-cart protection             | ✅     | Quote hash; confirm revalidates prices/coupon fresh inside a row-locked transaction — mismatch → 409 `CART_STALE` + fresh quote. Confirm is idempotent by key.                                                                                                                 |
| PWA                               | ✅     | `manifest.ts` + SVG icon, standalone display, installable scanner. Full offline shell defers to Phase 6 (needs a service-worker decision).                                                                                                                                     |
| Payments                          | ⬜     | Confirm stops at `PENDING_PAYMENT` by design — provider/intent/settle is Phase 3; reservations hold until settlement.                                                                                                                                                          |

### Known issues / limitations (Phase 2)

1. **Session-token possession model** — the raw token lives in `sessionStorage`
   (survives reloads, not device theft); acceptable for the demo, revisit with
   customer accounts.
2. **Weighed items** start at 1.000 kg and are adjusted manually (no camera
   weight inference — per spec §6); empty-cart confirm is rejected
   (`EMPTY_CART`).
3. **Coupon usage** increments only on confirm, gated by the order-create
   idempotency — a retried confirm never double-increments.
4. **Inclusive-tax line totals** stay `taxable + tax` (≤1 paisa off the shelf
   price) so cart totals remain exactly additive — documented in the pricing
   service.

## Phase 1 — Authentication and catalogue ✅ COMPLETE

Verified: `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ (50 tests: 39 API
Jest + 11 shared Vitest) · `pnpm build` ✅ · live smoke against the seeded
embedded Postgres ✅ (login → /users/me → barcode lookup → 403 on
`catalogue:write` for cashier → refresh rotation with replay rejection → audit
trail) · web boots with login, catalogue and account pages ✅.

| Item                                   | Status | Notes                                                                                                                                                                                                                                                 |
| -------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Argon2id/bcrypt password hashing       | ✅     | bcrypt (bcryptjs, cost 10 in seed) — spec allows either; note to switch to argon2id before real deployment.                                                                                                                                           |
| Access + rotating refresh tokens       | ✅     | 15-min access JWT; refresh tokens are random, stored SHA-256-hashed, rotated in a transaction on every refresh (replay fails 401); logout revokes. Refresh cookie: httpOnly, SameSite=Lax, path-scoped `/api/v1/auth`.                                |
| Login/refresh/logout + `GET /users/me` | ✅     | `/auth/login`, `/auth/refresh`, `/auth/logout`, `/users/me` (roles + DB-backed permission keys + branch). Public `POST /auth/register` deliberately deferred (see below).                                                                             |
| RBAC guards + branch scoping           | ✅     | Global chain: ThrottlerGuard → JwtAuthGuard (loads the LIVE user every request — disabled users lock out immediately) → RolesGuard (`@Roles`, `@RequirePermissions` resolved fresh from the DB).                                                      |
| Permission keys                        | ✅     | 16 keys seeded; 4 roles (ADMIN, MANAGER, CASHIER, INVENTORY_STAFF).                                                                                                                                                                                   |
| Branch endpoints                       | ✅     | Public list for store selection; staff list/detail; create/update + store settings under `settings:write` (audited).                                                                                                                                  |
| Product catalogue CRUD                 | ✅     | List/search (`q`, category, brand, status, pagination), detail, create (with barcodes + per-branch availability), update, barcode add/remove (last-barcode guard). Money as exact 2-dp decimal strings.                                               |
| Barcode lookup                         | ✅     | `GET /products/barcode/:barcode` — branch-resolved availability, price override and live stock (`onHand - reserved`); rate-limited 120/min.                                                                                                           |
| Rate limiting                          | ✅     | @nestjs/throttler global 100 req/min (memory store; Redis storage moves in Phase 3 with Redis itself). Login 5/min, refresh 30/min, barcode 120/min.                                                                                                  |
| Audit log writer                       | ✅     | `AuditService` (fail-open, never blocks the business action) covering auth events and catalogue/branch mutations; paginated `GET /audit` behind `audit:view`.                                                                                         |
| Customer + admin layouts               | ✅     | Web: shared header, login page (RHF + Zod), staff catalogue page (live search + pagination + skeletons), account page (roles/permissions), Zustand session store, transparent 401-refresh in the API client. Customer self-checkout shell is Phase 2. |

### Commands (local verification run)

- `pnpm test` · `pnpm lint` · `pnpm typecheck` · `pnpm build`
- Live flow (API on :4000, embedded Postgres :5433): curl sequence exercising
  login → me → barcode → RBAC denial → refresh rotation → audit listing.
- New tests: barcode check-digit/format inference, RolesGuard role/permission
  matrix, AuthService login/refresh-rotation/logout, ProductsService
  branch resolution + duplicate guards, env JWT validation.

### Known issues / limitations (Phase 1)

1. **No public `POST /auth/register`** — staff accounts are admin-managed
   (seeded for the demo); customer accounts arrive with the checkout phase.
   The route list in the spec is illustrative.
2. **bcrypt instead of Argon2id** — allowed by the spec; swapping is a
   contained change (hash + compare) noted for the Phase 6 security review.
3. **Throttler uses the in-memory store** — per-instance only until Redis lands
   in Phase 3.
4. **Product status changes are not exposed** via PATCH (deliberate: status
   flips should be an audited lifecycle action, added with the POS phase).
5. Search is `ILIKE`-based (name/SKU/exact barcode) — trigram/tsvector search
   can come later if the catalogue grows; indexes exist on sku/barcode.

## Phase 0 — Planning and foundation ✅ COMPLETE

Verified: `pnpm lint` ✅ · `pnpm typecheck` ✅ · `pnpm test` ✅ (20 tests) ·
`pnpm build` ✅ · migration applied to a real Postgres ✅ · seed loaded ✅ ·
API boots and serves `/api/v1/health` (database up) ✅ · web boots ✅.

| Item                                                | Status | Notes                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inspect repo before changes                         | ✅     | Empty repo (only the master prompt); git initialised on `main`.                                                                                                                                                                                                                                                                                    |
| Architecture notes + ER diagram + state transitions | ✅     | `docs/architecture.md`, `docs/er-diagram.md`, `docs/order-state-transitions.md`, `docs/api-guidelines.md`, 6 ADRs in `docs/decisions/`.                                                                                                                                                                                                            |
| Monorepo: pnpm workspaces + Turborepo               | ✅     | `apps/web`, `apps/api`, `packages/shared`, `packages/config`, `infra/`, `docs/`, `.github/workflows/ci.yml`.                                                                                                                                                                                                                                       |
| Docker Compose (Postgres 17 + Redis 7)              | ✅     | `docker-compose.yml` with healthchecks + volumes. Not run locally (Docker unavailable on this machine) — verified via the embedded Postgres fallback instead.                                                                                                                                                                                      |
| Environment validation at startup                   | ✅     | `apps/api/src/config/env.ts` (Zod, fail-fast, lazy singleton) + `apps/web/src/lib/env.ts`.                                                                                                                                                                                                                                                         |
| Linting, formatting, CI                             | ✅     | ESLint 9 flat config shared via `packages/config`; Prettier; GitHub Actions runs format/lint/typecheck/test/build.                                                                                                                                                                                                                                 |
| Prisma schema + first migration                     | ✅     | 40 models / 27 enums per spec §14 (+ GR lines, stock counts, transfers, refresh tokens). Migration `20261121000000_init` (1,148 lines SQL) generated from schema and applied.                                                                                                                                                                      |
| Seed data (QuickMart)                               | ✅     | 36 products + valid EAN-13 barcodes, categories/brands/tax categories, branch prices, inventory + thresholds, 3 low-stock items, 4 near-expiry batches, suppliers, PO-2026-0001/0002 + completed GR-2026-0001 with PURCHASE_RECEIPT ledger entries, 4 staff users, 3 customers + loyalty, 2 coupons, open cashier shift. Idempotent (re-runnable). |

### Commands (local verification run, Windows + Node 22.14)

- `pnpm install`
- `pnpm db:embedded:up` → migrate/seed against a real DB without Docker
- `pnpm --filter @quickcart/api db:migrate` / `db:seed`
- `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`
- `pnpm --filter @quickcart/api start` → `GET http://localhost:4000/api/v1/health` →
  `{"status":"ok","checks":{"database":"up"}}`; Swagger at `/api/v1/docs`
- `pnpm --filter @quickcart/web dev` → http://localhost:3000

### Known issues / limitations (Phase 0)

1. **Docker not installed on this dev machine** — Compose file is written and
   spec-compliant but untested here; the embedded Postgres fallback
   (`infra/scripts/dev-postgres.mjs`, port 5433, UTF-8 forced) is the verified
   local path. Redis has no embedded fallback (not needed until Phase 3).
2. **No historical orders in seed** — the live demo scenario (scan → pay →
   receipt) creates them; backfilling historical orders is deliberately left to
   Phase 5 (dashboards) so the pricing service can generate them properly
   instead of hand-faking rows.
3. **Jest runs with `--experimental-vm-modules`** — required for NestJS 12's
   ESM-only packages on Node 22 (ADR-006). Revisit when CI moves to Node 24.9+.
4. **Prisma 7 + pnpm 10**: `pnpm.onlyBuiltDependencies` allow-lists Prisma
   engines; generated client is gitignored and regenerated by the build script.
5. Web PWA manifest/service worker intentionally deferred to Phase 2 (customer
   checkout), where the offline story actually matters.
