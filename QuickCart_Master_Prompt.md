# QuickCart --- Master Build Prompt

## Supermarket Self-Checkout, POS and Real-Time Inventory Platform

Use this document as the master prompt for an AI coding agent
(Antigravity, Codex, Claude Code, etc.). Build the application as a
production-minded, portfolio-quality full-stack system. Do not create
only a UI mockup: implement working flows, persistent data, validation,
authorization, tests and local setup.

---

# 1. Product vision

Build **QuickCart**, a supermarket self-checkout platform that lets
customers scan product barcodes, create a digital cart, pay, and receive
a digital receipt without waiting at a traditional billing counter.

QuickCart must also integrate with the supermarket's staff-operated POS
and inventory system. A completed sale from either self-checkout or the
staff POS must update stock and sales data consistently in real time.

The product should support: - A single supermarket for the initial
MVP. - Multiple branches through a multi-store-ready data model. -
Customer self-checkout on a mobile-friendly web app/PWA. -
Staff-assisted checkout from a staff POS interface. - Admin and manager
dashboards. - A simulated/demo payment mode and a payment-provider
integration abstraction. Do not collect or store raw card details.

The result should feel like a credible retail software product, not a
student CRUD project.

# 2. Recommended technology stack

Use a TypeScript-first stack with a separate frontend and backend.

## Frontend

- **Next.js (App Router)**
- **React + TypeScript**
- **Tailwind CSS**
- **shadcn/ui** for accessible components
- **TanStack Query** for server state and caching
- **Zustand** for local cart/session UI state where appropriate
- **React Hook Form + Zod** for forms and validation
- **Socket.IO Client** for live stock/session/order updates
- **PWA support** so the customer checkout can be installed on a phone
- Browser camera access using `getUserMedia` and a maintained
  barcode-scanning library such as `@zxing/browser`

## Backend

- **NestJS + TypeScript**
- REST API with versioned routes (`/api/v1`)
- **Prisma ORM**
- **PostgreSQL** as the primary database
- **Redis** for short-lived session state, caching, rate limiting and
  job coordination
- **Socket.IO** through NestJS gateways for real-time events
- **BullMQ** for background jobs such as receipt delivery, exports and
  reconciliation
- OpenAPI/Swagger API documentation

## Infrastructure and quality

- Docker and Docker Compose for local development
- GitHub Actions for lint, type-check, test and build
- Jest for backend unit/integration tests
- Playwright for end-to-end browser tests
- ESLint + Prettier
- Structured logging with request IDs
- Environment variables validated at startup
- S3-compatible object storage abstraction for product images (local
  storage in development is acceptable)

## Payments

- Create a `PaymentProvider` interface so providers can be swapped.
- Implement a **mock payment provider** first for reliable local
  demos.
- Add a Razorpay test-mode adapter as an optional integration for the
  Indian market.
- Verify payment status on the server using provider
  webhooks/signature verification.
- Never trust a frontend "payment successful" flag.
- Never store card numbers, CVV or other raw card credentials.

## Deployment target

- Frontend: Vercel or another Next.js-compatible host.
- Backend: Render, Railway, Fly.io or a container host.
- Database: managed PostgreSQL.
- Redis: managed Redis.
- Keep the app deployable with Docker even if the demo uses separate
  hosting providers.

Do not add microservices initially. Use a **modular monolith** in NestJS
with clear module boundaries. This is easier to build, test and explain
while still demonstrating strong architecture.

# 3. User roles and permissions

Implement role-based access control (RBAC). Enforce permissions in
backend guards/services, not only by hiding frontend buttons.

## Customer

- Start a checkout session.
- Scan/search products.
- Add, remove and change quantities.
- View price, discount and tax breakdown.
- Apply an eligible loyalty reward.
- Pay and view/download receipt.
- View their own recent purchases and loyalty balance.

## Cashier

- Use the staff POS.
- Search/scan products.
- Create and complete assisted sales.
- Apply only permitted discounts.
- Suspend and resume a sale.
- Process permitted returns/refunds.
- View assigned shift activity.

## Store manager

- Manage products and prices for assigned branch.
- View branch inventory and sales.
- Approve stock adjustments and selected refunds.
- Create purchase requests.
- View staff and shift reports.

## Admin / owner

- Manage branches, users, roles and permissions.
- Manage global product catalogue and tax configuration.
- View consolidated reports.
- Configure payment and store settings.
- Review audit logs and system health.

## Inventory staff

- Receive deliveries.
- Record batch/expiry details.
- Perform stock counts and adjustments.
- Initiate branch transfers.
- Review low-stock and near-expiry alerts.

# 4. Main application areas

Create separate, clearly designed application experiences:

1.  **Customer self-checkout** --- mobile-first.
2.  **Staff POS** --- desktop/tablet-first, optimized for speed.
3.  **Admin dashboard** --- desktop-first management interface.
4.  **Inventory workspace** --- receiving, stock counts, batches and
    transfers.

Use a shared design system, navigation conventions and authentication
layer, but tailor each interface to its task.

# 5. Core customer self-checkout flow

Implement this complete flow:

1.  Customer opens QuickCart at the store, selects the branch or scans a
    store QR code.
2.  Customer starts a checkout session.
3.  App displays a clear scanning screen and requests camera permission
    only after the customer taps "Start scanning".
4.  Customer scans a product barcode.
5.  Backend looks up the barcode and returns product name, image, unit,
    current branch price, availability and applicable tax/discount.
6.  Product is added to the cart. If already present, quantity is
    incremented.
7.  Customer can change quantities, remove items or search for products
    manually.
8.  Cart totals update using server-authoritative pricing rules.
9.  Customer reviews subtotal, item discounts, coupon discount, tax and
    final total.
10. Customer optionally applies loyalty points/reward subject to policy.
11. Customer confirms checkout and chooses an available payment method.
12. Payment is processed through the mock provider or configured test
    provider.
13. Backend verifies the payment result and completes the order exactly
    once.
14. Inventory is decremented atomically.
15. A receipt is generated and displayed, with an option to download or
    email it.
16. Admin/POS dashboards receive real-time order and stock updates.

Provide clear error and recovery states: - Barcode not found. - Product
unavailable at this branch. - Camera permission denied. - Network lost
while scanning. - Price changed during checkout. - Payment pending,
failed or cancelled. - Duplicate payment callback. - Session expired. -
Item removed from sale by staff.

Do not let a customer complete payment for a stale or invalid cart.
Revalidate prices, promotions, stock and tax on the server at checkout.

# 6. Barcode and product catalogue

Each product should support: - Internal product ID / SKU. - One or more
barcodes (EAN-13, UPC-A, Code 128 where appropriate). - Product name and
description. - Category and optional brand. - Product image. - Unit
type: piece, kg, g, litre, ml, pack, etc. - Selling price and optional
MRP. - Tax category and applicable GST rate. - Active/inactive status. -
Whether it is age-restricted or requires staff assistance (model this
capability, but do not implement regulated product sales in the demo). -
Branch-specific availability and price override if enabled.

Barcode behavior: - Use the device camera for scanning. - Add manual
SKU/name search as a fallback. - Provide a demo mode with sample
products and sample barcodes. - Include a USB/Bluetooth keyboard-wedge
scanner-compatible input on the staff POS. Most such scanners type the
barcode and send Enter. - Debounce repeated camera detections so one
physical scan does not accidentally add multiple units. - Show a visible
confirmation when a scan succeeds.

For weighted products, support a clearly defined MVP approach: staff can
select the weight/quantity manually. Do not pretend a normal camera
barcode can infer an item's weight.

# 7. Cart, pricing, discounts and GST

Build a reusable pricing service on the backend. The frontend may
preview totals, but the backend is authoritative.

Support: - Quantity and unit-aware line items. - Product-level
discounts. - Cart-level coupon codes. - Branch-specific promotions. -
Loyalty redemption rules. - GST calculation using configurable tax
categories. - Configurable inclusive/exclusive tax handling. - Rounding
rules that avoid inconsistent totals. - Price snapshots on order lines
so historical receipts do not change when catalogue prices change.

For the Indian demo: - Support GST rates as configurable values; do not
hardcode one rate for all products. - Store tax components and the
calculation basis for each order line. - Where applicable, represent
CGST/SGST for intra-state sales and IGST for inter-state sales according
to configured store/customer transaction context. - Treat GST
configuration and invoice compliance as settings that require review by
a qualified accountant before real commercial use. - Generate a demo
receipt/invoice with store details, invoice number, line items,
discounts, tax breakdown and total.

Never calculate final payment totals solely in the browser.

# 8. Inventory and POS synchronization

This is one of the most important parts of the project.

Create a single inventory and order domain used by both customer
self-checkout and staff POS. Do not build two separate stock systems.

Required behavior: - A completed self-checkout sale reduces the correct
branch's stock. - A completed staff POS sale reduces the same stock
ledger. - Stock changes appear in connected dashboards in real time. -
Failed or cancelled payments must not permanently reduce stock. - A
payment success callback must not create duplicate orders or decrement
stock twice. - Concurrent checkouts must not oversell stock.

Use database transactions and appropriate row locking/conditional
updates or another robust concurrency strategy. Define the exact
reservation strategy: - At checkout start, optionally reserve stock for
a short configurable period. - Release reservations on
expiry/cancellation. - On successful payment, convert the reservation
into a sale. - If not using reservations in the MVP, perform an atomic
stock availability check and decrement at order completion.

Maintain an immutable stock movement ledger with movement types such
as: - SALE - RETURN - PURCHASE_RECEIPT - MANUAL_ADJUSTMENT -
TRANSFER_OUT - TRANSFER_IN - RESERVATION - RESERVATION_RELEASE

Never silently overwrite inventory history. Corrections should create
new ledger entries with a reason and actor.

# 9. Staff POS

Build a fast staff-operated POS screen with: - Barcode scanner input. -
Product search. - Cart with editable quantity. - Customer selection
(optional). - Discount application subject to permission. - Tax and
total calculation. - Cash, mock digital payment and configured provider
payment options. - Complete sale and print-friendly receipt. -
Suspend/resume cart. - Return/refund workflow with reason and
authorization. - Cashier/shift summary.

The POS and customer self-checkout must use the same backend pricing,
order and inventory services.

# 10. Admin and manager dashboard

Create useful, data-backed dashboards. Do not use decorative charts with
hardcoded numbers.

Include: - Today's gross sales and order count. - Average basket
value. - Sales by hour/day. - Top-selling products. - Low-stock
products. - Near-expiry batches. - Payment method breakdown. -
Returns/refunds. - Stock movement history. - Branch comparison when
multiple branches exist. - Recent orders and live activity feed.

Add filters for date range, branch, category and payment status. Use
pagination for large tables and provide loading, empty and error states.

# 11. Inventory management

Implement: - Product catalogue CRUD. - Barcode management. - Branch
stock view. - Stock receiving against a purchase order or delivery. -
Batch/lot tracking with expiry dates for applicable products. -
Near-expiry alerts. - Low-stock thresholds and reorder suggestions. -
Stock count and discrepancy approval. - Manual adjustment with mandatory
reason and audit record. - Supplier records. - Purchase orders. - Goods
received workflow. - Inter-branch stock transfers as a stretch feature.

For products with expiry dates, support FEFO (first-expiry-first-out) as
the recommended picking/stock allocation policy. Make the policy visible
and testable.

# 12. Loyalty and customer features

Implement a simple, auditable loyalty system: - Customer profile with
name and contact details. - Loyalty balance. - Earn points based on
configurable eligible spend. - Redeem points under configurable rules. -
Record every earning, redemption, reversal and expiry in a loyalty
ledger. - Prevent negative balances and duplicate earning. - Show
loyalty activity on the customer profile.

Do not store loyalty balance as an unexplained editable number. Derive
it from ledger entries or maintain it with transactionally consistent
ledger updates.

# 13. Real-time behavior

Use Socket.IO for: - New order notifications. - Inventory changes. -
Low-stock alerts. - Checkout session status. - Payment status changes. -
POS activity feed.

Security requirements: - Authenticate socket connections. - Authorize
branch/role room membership on the server. - Never allow a customer to
subscribe to another customer's session. - Do not broadcast sensitive
customer/payment data. - Treat socket events as notifications; the
database remains the source of truth. - On reconnect, clients must
refetch authoritative state.

Document event names and payload shapes. Include tests for unauthorized
room subscriptions.

# 14. Data model

Design a normalized PostgreSQL schema with Prisma. At minimum consider
these entities:

- User
- Role
- Permission
- UserRole / RolePermission
- Branch
- StoreSettings
- Customer
- Product
- ProductBarcode
- Category
- Brand
- TaxCategory
- BranchProduct / BranchPrice
- InventoryBalance
- InventoryBatch
- StockMovement
- StockReservation
- Supplier
- PurchaseOrder
- PurchaseOrderLine
- GoodsReceipt
- CheckoutSession
- CheckoutSessionItem
- Cart (if separate from session)
- Order
- OrderItem
- Payment
- Refund
- Promotion
- Coupon
- LoyaltyAccount
- LoyaltyLedgerEntry
- Receipt
- CashierShift
- AuditLog
- Notification

Use UUIDs or another consistent identifier strategy. Add indexes for
common lookups such as barcode, SKU, branch/product inventory, order
date, payment status and customer order history.

Include: - Created/updated timestamps. - Soft-delete only where it makes
sense. - Unique constraints for barcodes and idempotency keys. - Foreign
keys and appropriate delete behavior. - Decimal types for money; never
use floating-point numbers for currency. - Explicit status enums and
documented state transitions.

Before coding features, produce an ER diagram (Mermaid is acceptable)
and explain important transaction boundaries.

# 15. API design

Use `/api/v1` and organize NestJS modules by domain. Example route
groups:

## Authentication and users

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /users/me`

## Catalogue

- `GET /products`
- `GET /products/barcode/:barcode`
- `GET /products/:id`
- Admin product create/update endpoints.

## Checkout

- `POST /checkout/sessions`
- `GET /checkout/sessions/:id`
- `POST /checkout/sessions/:id/items/scan`
- `PATCH /checkout/sessions/:id/items/:itemId`
- `DELETE /checkout/sessions/:id/items/:itemId`
- `POST /checkout/sessions/:id/quote`
- `POST /checkout/sessions/:id/confirm`
- `POST /checkout/sessions/:id/cancel`

## Payments

- `POST /payments/intent`
- `POST /payments/webhooks/:provider`
- `GET /payments/:id`

## Orders and receipts

- `GET /orders`
- `GET /orders/:id`
- `GET /orders/:id/receipt`
- `POST /orders/:id/refunds`

## Inventory

- `GET /inventory`
- `GET /inventory/movements`
- `POST /inventory/adjustments`
- `POST /inventory/receipts`
- `POST /inventory/transfers`

## POS

- `POST /pos/sales`
- `POST /pos/sales/:id/suspend`
- `POST /pos/sales/:id/resume`
- `POST /pos/sales/:id/complete`

## Dashboard

- `GET /dashboard/summary`
- `GET /dashboard/sales`
- `GET /dashboard/top-products`
- `GET /dashboard/alerts`

These are illustrative routes. Refine them based on the final domain
model. Use DTO validation, consistent error responses, pagination,
filtering and Swagger documentation. Do not expose internal database
entities directly as API contracts.

# 16. Security and reliability

Implement: - Password hashing with Argon2id or bcrypt using secure
parameters. - Short-lived access tokens and securely handled refresh
tokens. - RBAC and branch-level authorization. - DTO validation and
output shaping. - Rate limiting on login, barcode lookup and checkout
endpoints. - CORS allowlist. - Secure headers. - CSRF protection where
cookie-based authentication requires it. - Secrets only in environment
variables. - Payment webhook signature verification. - Idempotency keys
for payment/order completion. - Audit logs for sensitive administrative
actions. - Protection against IDOR and cross-branch data access. - No
sensitive payment data in logs. - Database backups and migration
strategy documented.

Assume all frontend input can be manipulated. Enforce all business rules
on the backend.

# 17. UI and visual direction

Create a polished, modern retail SaaS interface. Avoid a generic
AI-generated dashboard look.

Design principles: - Clear hierarchy and strong typography. - Neutral
background with one restrained brand accent. - Consistent spacing,
border radius and shadows. - High contrast for prices, totals and
primary actions. - Large touch targets on the customer scanner and
POS. - Minimal steps to scan and add an item. - Responsive layouts for
mobile, tablet and desktop. - Accessible keyboard navigation and visible
focus states. - Skeleton loading, empty states, error states and toast
feedback. - Do not overload the customer checkout with admin features.

Suggested screens: 1. Customer welcome / select store. 2. Start
checkout. 3. Barcode scanner. 4. Shopping cart. 5. Discounts and
loyalty. 6. Payment. 7. Success and receipt. 8. Staff POS. 9. Product
catalogue. 10. Inventory overview. 11. Stock receiving and adjustments. 12. Orders and refunds. 13. Sales analytics. 14. User/role/branch
settings. 15. Audit log.

# 18. Demo data and seed scenario

Create realistic seed data for a fictional supermarket called
**QuickMart**: - One branch initially, with schema support for more. -
At least 30 products across grocery categories. - Include sample
barcodes, images or placeholders, units, prices and GST categories. -
Include stock levels, low-stock thresholds and a few expiring batches. -
Create demo users for admin, manager, cashier and inventory staff. -
Create a few customers, suppliers, purchase orders and historical
orders.

Provide clearly documented development-only credentials. Never seed
production credentials.

Create a demo scenario: 1. Customer scans two milk packets and one
bread. 2. Cart shows correct quantities, discounts and tax. 3. Customer
completes a mock payment. 4. Order and receipt are created. 5. Inventory
ledger records the sale. 6. Staff POS and admin dashboard update in real
time. 7. A low-stock alert appears if the threshold is crossed. 8. A
second customer attempting to buy more than available stock is prevented
from overselling.

# 19. Testing requirements

Write meaningful tests, not just snapshot tests.

## Backend unit tests

- Pricing and GST calculation.
- Promotion eligibility.
- Loyalty earn/redeem rules.
- Stock availability.
- FEFO batch selection.
- Order state transitions.
- Role/branch authorization.

## Backend integration tests

- Barcode lookup.
- Checkout session lifecycle.
- Payment success and failure.
- Duplicate webhook/idempotency behavior.
- Atomic inventory decrement.
- Concurrent checkout attempts.
- Refund and stock-return behavior.
- POS and self-checkout sharing the same inventory service.

## Frontend / E2E tests

- Customer scans or manually searches a product.
- Cart quantity changes.
- Checkout validation.
- Mock payment success.
- Payment failure recovery.
- Receipt display.
- Cashier completes a POS sale.
- Admin cannot access another branch without permission.

Include test instructions and a command to run the full suite.

# 20. Build plan --- implement in phases

Do not attempt every feature in one giant code-generation pass. Work in
milestones and keep the app runnable after each milestone.

## Phase 0 --- Planning and foundation

- Inspect the repository before changing anything.
- Create architecture notes and ER diagram.
- Set up monorepo or clearly separated frontend/backend folders.
- Configure Docker Compose for PostgreSQL and Redis.
- Configure environment validation, linting, formatting and CI.
- Add Prisma schema and first migration.
- Add seed data.

## Phase 1 --- Authentication and catalogue

- Implement authentication and RBAC.
- Implement branches and product catalogue.
- Implement barcode lookup and product search.
- Build initial customer and admin layouts.

## Phase 2 --- Customer cart and checkout

- Implement checkout sessions.
- Implement barcode scanning and manual search.
- Implement cart operations and server-side quote calculation.
- Implement discounts and GST calculation.
- Add checkout expiry and recovery states.

## Phase 3 --- Orders, payment and inventory

- Implement mock payment provider.
- Implement idempotent payment completion.
- Implement order and receipt creation.
- Implement transactional inventory decrement and stock ledger.
- Add concurrency and duplicate-webhook tests.

## Phase 4 --- Staff POS and live updates

- Build staff POS.
- Reuse the same pricing/order/inventory services.
- Add Socket.IO events and authorized subscriptions.
- Show real-time updates in the admin dashboard.

## Phase 5 --- Inventory operations and analytics

- Add receiving, batches, expiry alerts and adjustments.
- Add low-stock alerts and purchase suggestions.
- Add dashboard metrics and filters.
- Add loyalty ledger.

## Phase 6 --- Hardening and deployment

- Complete security review.
- Add Playwright end-to-end tests.
- Add logs, health checks and error handling.
- Add CI pipeline and deployment documentation.
- Verify clean installation from the README.

# 21. Repository structure

Use a maintainable structure similar to:

```text
quickcart/
  apps/
    web/                    # Next.js frontend
    api/                    # NestJS backend
  packages/
    shared/                 # Shared types/constants only where appropriate
    config/                 # Shared lint/TypeScript configuration
  infra/
    docker/
    scripts/
  docs/
    architecture.md
    er-diagram.md
    api-guidelines.md
    decisions/
  .github/
    workflows/
  docker-compose.yml
  README.md
```

If a monorepo tool is used, choose one (for example pnpm workspaces with
Turborepo) and configure it correctly. Do not introduce tooling without
a clear benefit.

# 22. Required developer experience

The repository must include: - Complete README with prerequisites and
setup commands. - `.env.example` with descriptions, no real secrets. -
Docker Compose for local dependencies. - Database migration and seed
commands. - Demo login credentials for development. - Swagger URL. -
Test commands. - Build and run commands. - Deployment guide. -
Architecture diagram and ER diagram. - Known limitations and future
improvements.

A new developer should be able to clone the repository, configure
environment variables, run Docker Compose, migrate/seed the database and
start the app by following the README.

# 23. Non-negotiable engineering rules

1.  Inspect the existing project before editing. Preserve working code
    unless a change is justified.
2.  Do not generate the entire application in one pass. Implement one
    milestone at a time.
3.  Do not leave fake buttons, dead links or placeholder screens
    presented as completed features.
4.  Do not use hardcoded dashboard metrics. Derive them from the
    database.
5.  Do not trust client-side price, tax, stock or payment status.
6.  Do not use floating-point arithmetic for money.
7.  Do not decrement stock twice when a payment webhook is retried.
8.  Do not allow unauthorized cross-branch or cross-customer access.
9.  Do not store raw card data.
10. Add tests for critical business logic before declaring a milestone
    complete.
11. Keep code modular, typed and documented where the reasoning is not
    obvious.
12. After each milestone, run formatting, lint, type-check, tests and
    production builds; fix failures before proceeding.
13. Keep a `docs/implementation-status.md` checklist updated with
    completed work, test results, known issues and next steps.
14. If a requirement is ambiguous, state the assumption in the
    documentation and choose the simplest safe implementation rather
    than silently inventing complex behavior.

# 24. First task for the coding agent

Start by **planning, not coding the whole product**.

Return: 1. A concise architecture proposal. 2. The proposed database ER
diagram. 3. The checkout/order/payment/inventory state transitions. 4.
The repository structure. 5. A milestone-by-milestone implementation
checklist. 6. Risks and decisions that need to be made.

Then implement **Phase 0 only**. Once Phase 0 is complete, report the
exact files created, commands run, test/build results and any remaining
issues. Do not continue to Phase 1 until the foundation is verified.

The final goal is a working, secure, demonstrable supermarket
self-checkout and POS platform with reliable real-time inventory
synchronization.
