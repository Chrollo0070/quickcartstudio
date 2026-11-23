# State Transitions: Checkout → Order → Payment → Inventory

> Statuses live in `apps/api/prisma/schema.prisma` enums. These transitions are
> the contract the Phase 2–4 services implement; every allowed move below has a
> test obligation in its phase.

## 1. CheckoutSession

```mermaid
stateDiagram-v2
    [*] --> OPEN: create session (branch, channel)
    OPEN --> SUSPENDED: POS only — cashier parks the sale
    SUSPENDED --> OPEN: POS resume (revalidate prices on resume)
    OPEN --> CONVERTED: confirm() created order PENDING_PAYMENT
    OPEN --> EXPIRED: TTL elapsed (reaper job / lazy check)
    OPEN --> CANCELLED: customer cancels / staff voids
    SUSPENDED --> EXPIRED: TTL elapsed
    SUSPENDED --> CANCELLED: staff voids
    EXPIRED --> [*]
    CANCELLED --> [*]
    CONVERTED --> [*]
```

Rules:

- `SUSPENDED` is legal only for `channel = POS` (self-checkout sessions expire,
  they are never parked).
- Any transition out of `OPEN`/`SUSPENDED` releases all `ACTIVE`
  `StockReservation` rows (`RELEASED` + `RESERVATION_RELEASE` movements) inside
  the same transaction.
- Item mutations are allowed only while `OPEN` (or `SUSPENDED`→resume flow).
- Confirm on anything not `OPEN` returns a structured error — this is what makes
  double-click confirm / retried confirms no-ops.

## 2. Order

```mermaid
stateDiagram-v2
    [*] --> PENDING_PAYMENT: confirm() — order + items snapshot + Payment(INITIATED)
    PENDING_PAYMENT --> COMPLETED: payment verified (webhook/mock/cash settle)
    PENDING_PAYMENT --> FAILED: payment failed or session invalid at settle
    PENDING_PAYMENT --> CANCELLED: payment cancelled / session expired before settle
    COMPLETED --> PARTIALLY_REFUNDED: refund completed (sum < grand total)
    COMPLETED --> FULLY_REFUNDED: refund completed (sum == grand total)
    FAILED --> [*]
    CANCELLED --> [*]
    PARTIALLY_REFUNDED --> FULLY_REFUNDED: further refunds cover the rest
```

Rules:

- `PENDING_PAYMENT` orders are immutable snapshots; no price/item edits after
  creation — a changed cart means a new quote and a new confirmation.
- Only `COMPLETED` orders decrement stock (in the payment-settle transaction).
- `FAILED`/`CANCELLED` orders never touch the stock ledger; their reservations
  were already released when the session left `OPEN`.
- Refund transitions require role-gated approval (cashier requests, manager
  approves) before completion.

## 3. Payment

```mermaid
stateDiagram-v2
    [*] --> INITIATED: intent created (idempotency key)
    INITIATED --> PENDING: provider acknowledges, awaiting result
    INITIATED --> SUCCEEDED: mock settle / webhook verified
    PENDING --> SUCCEEDED: webhook verified
    PENDING --> FAILED: webhook verified failure
    PENDING --> CANCELLED: customer aborted / TTL
    FAILED --> [*]
    CANCELLED --> [*]
    SUCCEEDED --> [*]
```

Rules:

- **The transition to `SUCCEEDED` is authoritative**: it happens only after
  server-side verification (webhook signature, mock settle token, or cash
  counted by the cashier). A frontend "success" flag does nothing by itself.
- Duplicate callbacks: if the payment is already `SUCCEEDED`, the handler
  returns 2xx without side effects (the unique `providerRef` + status check).
- The settle transaction also completes the order and decrements stock — see §4.

## 4. Inventory

```mermaid
stateDiagram-v2
    [*] --> Reserved: scan-time reservation (available check, conditional update)
    Reserved --> Converted: payment settled → SALE movement
    Reserved --> Released: session expired/cancelled → RESERVATION_RELEASE
    Reserved --> Expired: reaper on TTL → RESERVATION_RELEASE
    [*] --> SoldNoReservation: POS express path (atomic check+decrement at settle)
    SoldNoReservation --> [*]: SALE movement
    [*] --> Received: goods receipt completed → PURCHASE_RECEIPT (+batch)
    [*] --> Adjusted: count approved / manual adjustment (reason + actor required)
    [*] --> Transferred: TRANSFER_OUT (from branch) / TRANSFER_IN (to branch)
    [*] --> Returned: refund completed → RETURN movement
```

Rules:

- `InventoryBalance.onHand - InventoryBalance.reserved` is "available". Every
  mutation of either column is a **conditional update** (`WHERE` guards against
  oversell), never a blind write.
- All changes append a `StockMovement` row in the same transaction; the ledger is
  immutable. Corrections create new entries with a reason and actor.
- Batch-consuming flows use **FEFO** (first-expiry-first-out) among non-expired
  batches when `InventoryBatch` rows exist for the product.
- `EXPIRED`/`RELEASED` reservations decrement `reserved` without touching
  `onHand` — the stock was never actually gone.
