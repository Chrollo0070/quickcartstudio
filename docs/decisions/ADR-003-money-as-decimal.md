# ADR-003: Money as Decimal — no floats, integer-math rounding

- **Status:** Accepted (Phase 0)
- **Context:** Supermarket carts mix piece and weighted goods, percent and fixed
  discounts, and GST components. Floats would drift paise.
- **Decision:**
  - Prisma `Decimal` columns for every monetary and quantity field.
  - `@quickcart/shared` money module performs all pre-DB arithmetic on scaled
    integers (`BigInt`) with explicit rounding modes (`HALF_UP` default,
    `HALF_EVEN`/`FLOOR`/`CEIL` configurable per store settings). Parsing accepts
    exact decimal strings only — a `number` never crosses the pricing boundary.
  - Frontends display server-computed totals; they never compute the payable
    amount.
- **Consequences:** Slightly more verbose arithmetic, but totals are consistent
  everywhere and unit-testable (`money.test.ts` covers parse, format, rescale).
