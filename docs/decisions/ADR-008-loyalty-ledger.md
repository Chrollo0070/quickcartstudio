# ADR-008: Loyalty as a ledger, integrated with checkout and settlement

- **Status:** Accepted (Phase 5, verified live)
- **Context:** The spec requires an auditable loyalty system: earn on eligible
  spend, redeem under configurable rules, every movement recorded, balances
  never an unexplained editable number (§12).
- **Decisions:**
  - `LoyaltyLedgerEntry` is the truth; `LoyaltyAccount.points` is updated
    transactionally alongside each entry (EARN/REDEEM/REVERSAL/EXPIRY), with
    `balanceAfter` snapshots for auditability.
  - **Attach-by-phone:** self-checkout sessions are anonymous until the
    customer types their phone number (`POST /checkout/sessions/:id/customer`).
    POS can do the same from the register in a later UI pass.
  - **Redeem (at quote/confirm):** points are validated live against the
    account balance and store rules (`loyaltyMinRedeemPoints`,
    `loyaltyRedeemRate`, max-percent cap field). The discount enters the
    pricing engine like the coupon (proportional per-line distribution) so
    GST taxable values stay accurate. Confirm writes the `REDEEM` entry with
    idempotency key `redeem:order:{orderId}` inside the confirm transaction.
  - **Earn (at settlement):** `floor(grandTotal × loyaltyEarnRate)` points are
    granted in the settle transaction with key `earn:order:{orderId}` — a
    webhook retry can never double-earn (and the duplicate-callback short-
    circuit precedes it anyway).
  - Refunds post `REVERSAL` entries (Phase 5 scope for full refunds: the
    earned points for a refunded order are reversed with the RETURN movements
    — wired with partial-refund work).
- **Consequences:** Every point movement is traceable to an order; balances
  reconcile with the ledger by construction. Expiry jobs (`EXPIRY`) need the
  Phase 6 scheduler (BullMQ/Redis) and are documented as pending.
