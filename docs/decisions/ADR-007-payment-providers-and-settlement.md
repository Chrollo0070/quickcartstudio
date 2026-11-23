# ADR-007: Payment providers, demo settlement and the settle transaction

- **Status:** Accepted (Phase 3, verified live)
- **Context:** The spec requires a swappable `PaymentProvider` interface, a
  reliable mock first, an optional Razorpay test-mode adapter, webhook
  signature verification, and settlement that decrements stock exactly once —
  with no Redis/Docker available locally for BullMQ.
- **Decisions:**
  - `PaymentProvider` interface (`createIntent` / `verifyWebhook` / `kind`).
    The mock provider's callback is an **HMAC-SHA256 signature over exact
    bytes** (`providerRef|outcome`, secret from env) — the demo UI's "Pay now"
    asks our server to emit the signed callback, so settlement runs through
    the _same_ verify → idempotency → settle path as a real provider webhook.
    Nothing client-supplied is ever trusted as a payment result.
  - Razorpay adapter: webhook verification (X-Razorpay-Signature) and event
    mapping are implemented locally; creating real Razorpay orders needs live
    API wiring + keys, so the adapter fails closed (`PROVIDER_NOT_CONFIGURED`)
    instead of faking a gateway.
  - **Settle transaction** (`RepeatableRead`): duplicate-callback short-circuit
    (already `SUCCEEDED` → 2xx `duplicate:true`, zero side effects) → amount
    check → per-line conditional onHand decrement (`WHERE on_hand >= qty`) →
    FEFO batch allocation (batch-linked SALE movements; plain movement only for
    unallocated remainder — the ledger sums to exactly the sold quantity) →
    reservation `CONVERTED` + `reserved` release → payment/order status →
    receipt row with sequential invoice number (`prefix + year + 6-digit`).
  - Ledger invariant: one unit sold → exactly one SALE movement (batch-linked
    when a batch covered it). Caught and fixed during live smoke.
- **Deferred (documented):** BullMQ receipt-delivery jobs and Redis-backed
  rate-limit storage need Redis; receipt rows are created transactionally now
  and the queue work lands with Redis in deployment (Phase 6/CI environment).
- **Consequences:** Payment completion is provably idempotent (unit-tested +
  live-retried webhook); stock can never oversell (conditional updates); the
  demo is honest — "mock" describes the money, not the safety machinery.
