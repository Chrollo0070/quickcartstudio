# ADR-004: Stock reservations for self-checkout; atomic check-and-decrement for POS

- **Status:** Accepted (Phase 0, implemented Phase 2–3)
- **Context:** Self-checkout customers hold a cart open for minutes while
  scanning; POS completion is seconds-fast. Both must never oversell and must
  not double-decrement on webhook retries.
- **Decision:**
  - **SELF_CHECKOUT:** scanning a product atomically increments
    `InventoryBalance.reserved` via a conditional update (fails when
    `onHand - reserved < qty`) and creates an `ACTIVE` `StockReservation` with a
    configurable TTL (default 10 min) plus a `RESERVATION` ledger movement. A
    reaper job expires stale reservations (`RESERVATION_RELEASE`).
  - **POS:** no reservation; the completion transaction performs the same
    conditional check-and-decrement.
  - **Payment settle (both channels):** one transaction converts the reservation
    (`CONVERTED`) and appends `SALE` movements, decrementing `onHand` with the
    same conditional guard (protects against a lapsed reservation racing with
    another buyer).
- **Consequences:** Available stock = `onHand - reserved` everywhere; the ledger
  records reservation lifecycle, so audits can follow every hold.
