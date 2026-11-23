# API Guidelines

> Applies to every endpoint under `/api/v1`. Living document — extend per phase.
> Swagger UI (dev): http://localhost:4000/api/v1/docs

## Versioning & structure

- All routes live under `/api/v1` (global prefix from the shared constant
  `API_PREFIX`). Breaking changes create `/api/v2`, never mutate v1 shapes.
- NestJS modules own one route group each (`auth`, `products`, `checkout`,
  `payments`, `orders`, `inventory`, `pos`, `dashboard`, `users`, `settings`).
- Internal Prisma models are never returned raw: controllers map to explicit DTO
  classes (output shaping) and validate input with Zod schemas.

## Conventions

### Responses

Success shapes are DTO classes. Error shapes follow one envelope:

```jsonc
// 4xx/5xx body (Nest HttpException shape, extended where useful)
{
  "statusCode": 400,
  "message": "Validation failed", // human-readable summary
  "error": "Bad Request",
  "fieldErrors": { "barcode": ["must be a string"] }, // zod-driven, optional
  "code": "CART_STALE", // stable machine code for domain errors, optional
}
```

Domain error codes (stable strings the frontend can branch on) are used whenever
the client needs to react: `CART_STALE`, `SESSION_EXPIRED`,
`PRODUCT_UNAVAILABLE`, `OUT_OF_STOCK`, `PAYMENT_PENDING`, `PAYMENT_FAILED`,
`DUPLICATE_CALLBACK`, `FORBIDDEN_BRANCH`, etc.

### Pagination & filtering

- List endpoints accept `?page=` (1-based) and `?limit=` (default 20, max 100)
  and return `{ data: [...], meta: { page, limit, total, totalPages } }`.
- Filters are explicit query params (date ranges `from`/`to`, `branchId`,
  `status`, `categoryId`), documented in Swagger per endpoint.
- Sorting via `?sort=createdAt&order=desc` with an allow-list of sortable fields.

### Auth (implemented in Phase 1)

- `Authorization: Bearer <access token>` (HS256 JWT, 15 min default via
  `JWT_ACCESS_TTL`). The guard re-reads the live user from the database on
  every request — disabled accounts and role changes take effect immediately.
- `POST /auth/login` → `{ accessToken, user }` + httpOnly refresh cookie
  (`qc_refresh`, SameSite=Lax, path `/api/v1/auth`). Rate limit: 5/min.
- `POST /auth/refresh` → rotates the refresh token (random, SHA-256-hashed at
  rest) and mints a new access token. Presenting a revoked/expired token →
  401 `BAD_REFRESH_TOKEN`; presenting a body token is supported for non-browser
  clients. Rate limit: 30/min.
- `POST /auth/logout` → revokes the refresh token, clears the cookie.
- `GET /users/me` → profile, roles, DB-backed permission keys, home branch.
- Authorization: `@Roles(...)` for coarse role checks and
  `@RequirePermissions(...)` for permission keys, both resolved fresh from the
  database. Failures: 403 `FORBIDDEN_ROLE` / `FORBIDDEN_PERMISSION` (with the
  missing keys). Branch scoping rides on the user's home branch; cross-branch
  access returns `403 FORBIDDEN_BRANCH` (or 404 where existence itself is
  sensitive).
- Rate limits: global 100 req/min per IP (login 5/min, refresh 30/min, barcode
  lookup 120/min). Memory store until Redis arrives in Phase 3.
- Errors on auth surfaces never reveal whether an email exists.
- Idempotency: mutating endpoints that can be retried accept
  `Idempotency-Key` and/or take an explicit idempotency field (payments, order
  completion, refunds). Replays return the original result.

### Real-time events (from Phase 4)

- Socket.IO gateway under the same auth; rooms `branch:{id}`, `dashboard:{id}`,
  `session:{id}` (owner-only).
- Events are **notifications** (IDs + coarse facts, never card data or PII);
  clients refetch authoritative REST state on receipt and on reconnect.
- Catalogue (documented as it ships):
  - `order.completed` → `{ orderId, channel, grandTotal, receiptNumber }` (staff branch rooms)
  - `inventory.updated` → `{ branchId, productId, available }`
  - `alert.low_stock` / `alert.near_expiry` → `{ branchId, productId, ... }`
  - `checkout.session.updated` → `{ sessionId }` (own session only)
  - `activity.order` → staff global feed (same payload as order.completed)
  - `payment.updated` → `{ paymentId, orderId, status }` (own session only)

## Validation

- Input is validated with Zod via `ZodValidationPipe` (per-route, typed) — one
  schema language across backend, frontend and env config.
- The backend re-derives everything it trusts: client-sent prices, totals, stock
  or payment flags are inputs at best and lies at worst.

## Health

- `GET /api/v1/health` returns liveness + dependency checks (`database: up|down`,
  503 when degraded). Deployment probes should use it as a readiness gate.
