# QuickCart Architecture

> Status: living document. Updated at the end of each phase.
> Related: [ER diagram](./er-diagram.md) · [Order/payment/inventory state transitions](./order-state-transitions.md) · [API guidelines](./api-guidelines.md) · [ADRs](./decisions/)

## 1. What we are building

QuickCart is a supermarket self-checkout platform (customer scans barcodes with a
phone, pays, gets a digital receipt) that shares **one pricing engine, one order
domain and one stock ledger** with the staff-operated POS. Real-time updates
(Socket.IO) keep dashboards and the register current.

Design constraints from the product brief:

- Single supermarket for the MVP, multi-store-ready data model (every operational
  row carries a `branchId`).
- Simulated/demo payments first; payment providers behind an interface.
- Server-authoritative everything: the browser never decides price, tax, stock or
  payment success.
- Modular monolith (no microservices), portfolio-quality and locally runnable.

## 2. Stack (and why)

| Layer                | Choice                                                                              | Why                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Frontend             | Next.js 16 (App Router) + React 19 + TypeScript                                     | One framework for the four experiences (customer, POS, admin, inventory) with tailored layouts; PWA support when checkout lands. |
| UI                   | Tailwind CSS 4 (+ shadcn/ui from Phase 1)                                           | Utility-first design system shared across all four experiences.                                                                  |
| Server state         | TanStack Query                                                                      | Caching, refetch-on-reconnect (required by the real-time spec), polling for status surfaces.                                     |
| Local UI state       | Zustand (Phase 2+)                                                                  | Cart/session UI state without polluting the server cache.                                                                        |
| Backend              | NestJS 12 (modular monolith)                                                        | Modules map 1:1 to domains; guards/interceptors/pipes give us RBAC, validation and logging in one place.                         |
| ORM / DB             | Prisma 7 + PostgreSQL                                                               | Decimal money, transactions with configurable isolation, immutable ledger tables, strong relational integrity.                   |
| Cache/queue/realtime | Redis + BullMQ + Socket.IO (Phases 3–4)                                             | Sessions, rate limits, receipt/export jobs, gateway fan-out.                                                                     |
| Validation           | Zod everywhere                                                                      | One schema language across API DTOs, env config and (later) forms.                                                               |
| Tests                | Jest (API), Vitest (shared), Playwright (E2E, Phase 6)                              | Spec-mandated Jest on the backend; Vitest is the lighter fit for a pure-TS shared package.                                       |
| Infra                | Docker Compose (Postgres 17 + Redis 7), GitHub Actions, Turborepo + pnpm workspaces | Reproducible local dev and CI; task graph without heavy tooling.                                                                 |

### Backend module map (built phase by phase)

```
AppModule
├── PrismaModule            (global DB access)          ✅ Phase 0
├── HealthModule            (liveness/readiness)        ✅ Phase 0
├── AuthModule              (register/login/refresh, guards, RBAC)   Phase 1
├── CatalogueModule         (products, barcodes, categories, tax)    Phase 1
├── BranchModule            (branches, settings)        Phase 1
├── CheckoutModule          (sessions, quote, pricing service)       Phase 2
├── PromotionsModule        (coupons, loyalty eligibility)           Phase 2/5
├── OrdersModule            (orders, receipts, refunds) Phase 3
├── PaymentsModule          (PaymentProvider interface, mock provider, Razorpay adapter, webhooks)  Phase 3
├── InventoryModule         (ledger, reservations, receiving, counts, transfers)  Phase 3/5
├── PosModule               (POS sale facade over checkout/orders)   Phase 4
├── RealtimeModule          (Socket.IO gateway, rooms)  Phase 4
├── DashboardModule         (metrics from the DB)       Phase 5
├── LoyaltyModule           (ledger-backed points)      Phase 5
├── JobsModule              (BullMQ: receipts, exports, reservation reaper)  Phase 3+
└── AuditModule             (audit log writer, shared)  Phase 1+
```

## 3. The one-inventory rule

Customer self-checkout and staff POS are **channels**, not separate systems. Both:

1. run `CheckoutSession` rows (`channel: SELF_CHECKOUT | POS`),
2. price through the same `PricingService` (server-side quote),
3. complete through the same `OrderCompletionService` (payment verification →
   order → stock decrement → ledger → receipt),
4. emit the same real-time events.

POS-only capabilities (suspend/resume, cash payments, refunds with approval) are
guards/flags on top of the shared domain, never parallel paths.

## 4. Transaction boundaries (the important part)

These are the operations where correctness matters most. All are single Postgres
transactions; isolation levels and row locks are chosen per operation.

### 4.1 Checkout session creation (Phase 2)

- Create `CheckoutSession` (status `OPEN`, `expiresAt = now + TTL` from settings).
- **Stock reservation strategy (ADR-004):** at scan time, atomically
  `UPDATE inventory_balance SET reserved = reserved + qty WHERE branch_id = … AND product_id = … AND on_hand - reserved >= qty`
  (conditional update; a failed condition means "not enough available") and insert
  an `ACTIVE` `StockReservation` row + a `RESERVATION` ledger movement. Reservations
  expire by TTL; a background reaper (BullMQ, Phase 3) converts expired rows to
  `EXPIRED` + `RESERVATION_RELEASE` movements and decrements `reserved`.
- Rationale: self-checkout holds stock while the shopper keeps scanning; POS
  completion is fast, so POS sessions may skip reservation and do a check-and-
  decrement inside the completion transaction.

### 4.2 Order completion (`POST /checkout/sessions/:id/confirm`) — Phase 3

One transaction, `REPEATABLE READ` (or explicit row locks on touched inventory rows):

1. Re-read the session **with a row lock**; reject if not `OPEN`/fresh (session
   expiry, cancelled, already converted — this is what makes duplicate confirms
   no-ops).
2. **Revalidate everything server-side**: prices (current branch price), promotion
   eligibility, loyalty redemption rules, stock availability (reservation if the
   session has one, else live availability). If anything drifted, return a
   structured `CART_STALE` error with a fresh quote; never accept stale client data.
3. Insert `Order` (`PENDING_PAYMENT`) + `OrderItem` (+ tax lines) with **price
   snapshots**; insert `Payment` (`INITIATED`, provider-neutral).
4. Mark the session `CONVERTED`.
5. Stock is **not** decremented yet — money hasn't been verified.

### 4.3 Payment completion (`POST /payments/webhooks/:provider` or mock settle) — Phase 3

One transaction:

1. Verify webhook signature (Razorpay) or the mock provider's settle token. Reject
   unsigned/invalid payloads before touching the DB.
2. Load payment by provider reference. If already `SUCCEEDED` → **return 2xx and
   do nothing** (webhooks retry; this is the duplicate-callback guarantee).
3. Set payment `SUCCEEDED`, order `COMPLETED`, `completedAt`, receipt number.
4. **Inventory decrement inside the same transaction**: conditional update
   `SET on_hand = on_hand - qty WHERE on_hand >= qty` per line (oversell guard, even
   if the reservation lapsed), release the session reservation (`CONVERTED` +
   `RESERVATION_RELEASE` movement), insert `SALE` ledger movements per line (batch
   allocation via FEFO for expiry-tracked products).
5. Loyalty earn entries (idempotency key `earn:order:{orderId}`) when rules apply.
6. Commit → emit `order.completed` / `inventory.updated` real-time events + enqueue
   receipt-delivery job.

Order completion and payment completion are deliberately separate transactions:
the client confirms the cart once, the provider may settle asynchronously, and a
paid order must exist even if the receipt job dies.

### 4.4 Refund — Phase 3/4

- Request (cashier) → approval (manager) → completion are separate state
  transitions (see [state transitions](./order-state-transitions.md)).
- The completing transaction: mark refund `COMPLETED`, reverse stock via `RETURN`
  movements (FEFO-agnostic; re-entering stock creates/updates a batch flagged
  `reason: return`), write loyalty `REVERSAL` entries if the original order earned
  points, set order `PARTIALLY_REFUNDED`/`FULLY_REFUNDED`.
- Idempotency: `Refund.idempotencyKey` unique per attempt.

### 4.5 Concurrency rules of thumb

- Money and stock mutations only through conditional updates (`WHERE` on
  availability) or row locks — never read-modify-write.
- Every externally-triggered mutation carries an idempotency key
  (`Order.idempotencyKey`, `Payment.idempotencyKey`, `Refund.idempotencyKey`,
  `LoyaltyLedgerEntry.idempotencyKey`).
- The stock ledger is append-only. Corrections are new entries with a reason and
  an actor; history is never rewritten.

## 5. Real-time design (Phase 4)

- One Socket.IO gateway; JWT-authenticated connections; room membership
  (`branch:{id}`, `dashboard:{branchId}`, `session:{id}`) granted server-side
  after role/branch checks.
- A customer may join only their own `session:{id}` room — enforced by comparing
  the session's owner/customer to the token subject.
- Events are **notifications**, not data: payloads carry IDs and coarse facts
  (never card data, never full customer PII). Clients refetch authoritative state
  via REST on any event and on reconnect.
- Event catalogue and payload schemas live in `docs/api-guidelines.md` as they
  ship.

## 6. Security posture (spec §16)

- Argon2id (fallback bcrypt) password hashing; short-lived access tokens + rotated
  refresh tokens (hashed at rest).
- RBAC guards + branch scoping in services (defense in depth: hide buttons _and_
  enforce server-side; cross-branch access returns 403/404).
- Zod-validated DTOs; consistent error envelope; no internal entity leakage.
- Rate limiting (Phase 1) on login, barcode lookup, checkout endpoints (Redis
  store).
- Helmet secure headers; CORS allowlist from env; secrets only in env vars.
- Payment webhooks: signature verification before DB access; raw card data never
  accepted, stored, or logged.
- Audit logs for admin/manager actions (who, what, entity, metadata, request id).
- No sensitive payment data in logs; request-id middleware correlates everything.

## 7. Deployment shape

- Frontend → Vercel (or any Next.js host). Backend → container host (Render/Railway/Fly).
  Postgres + Redis → managed services.
- The repo stays `docker compose`-runnable for local development; CI (GitHub
  Actions) runs format/lint/typecheck/test/build on every PR.
- Database migrations: `prisma migrate deploy` in the release pipeline; backups
  and restore drill documented in the deployment guide (Phase 6).

## 8. Known risks & mitigations

| Risk                                                                        | Mitigation                                                                                                                                                                 |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reservation-based stock hold can starve availability under abusive sessions | Short TTL (default 10 min), reaper job, per-customer session limits (Phase 2), reservations excluded from "available" everywhere.                                          |
| GST compliance nuance (place of supply, inclusive pricing, invoice formats) | Rates and components are config-driven; explicit "requires accountant review before commercial use" disclaimer; CGST/SGST vs IGST derived from branch state at quote time. |
| Duplicate webhook delivery / provider retries                               | Idempotency keys + "already succeeded → 2xx no-op" semantics; concurrency tests in Phase 3.                                                                                |
| Overselling under concurrent checkouts                                      | Conditional decrement + reservations; Phase 3 has an explicit concurrent-checkout integration test.                                                                        |
| Scope creep across 6 phases                                                 | `docs/implementation-status.md` is the single checklist; each phase must pass lint/typecheck/test/build before the next starts.                                            |
| Prisma 7 is a new major line                                                | Pinned 7.10.1 (the 8.x line is still an RC); generated client is committed to `.gitignore` and regenerated in builds.                                                      |
