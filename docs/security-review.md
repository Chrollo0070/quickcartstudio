# Security Review — Phase 6

> Status of each spec §16 requirement at the end of Phase 6. Verified by code
> inspection and live smoke unless marked otherwise. Re-run before any real
> deployment.

## Implemented and verified

| Requirement                                | Status         | Evidence                                                                                                                                                                           |
| ------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password hashing                           | ✅             | bcrypt cost 10 (seed); switch to Argon2id noted below.                                                                                                                             |
| Short-lived access tokens + secure refresh | ✅             | 15-min HS256 JWT; refresh tokens random 48-byte, SHA-256 at rest, transactional rotation, replay → 401 (live-tested).                                                              |
| RBAC + branch-level authorization          | ✅             | Global guard chain (Throttler → JwtAuthGuard loading live user → RolesGuard with DB-backed permissions); branch scoping on inventory/dashboard; POS requires `pos:operate`.        |
| DTO validation + output shaping            | ✅             | ZodValidationPipe on bodies/queries; explicit DTO classes; no raw entities returned.                                                                                               |
| Rate limiting                              | ✅             | Global 100/min (memory), login 5/min, refresh 30/min, barcode 120/min. Memory store = per-instance only until Redis.                                                               |
| CORS allowlist                             | ✅             | `CORS_ORIGINS` env, credentials enabled for the refresh cookie.                                                                                                                    |
| Secure headers                             | ✅             | helmet() with defaults; X-Request-Id correlation.                                                                                                                                  |
| CSRF                                       | ✅ (mitigated) | Refresh cookie is SameSite=Lax + path-scoped to `/api/v1/auth`; token-based auth elsewhere. Cross-site POSTs carrying the cookie are blocked by Lax for non-top-level navigations. |
| Secrets in env only                        | ✅             | Zod-validated env; JWT/webhook secrets required; `.env` gitignored.                                                                                                                |
| Webhook signature verification             | ✅             | Mock: HMAC over exact bytes before any DB access (live-tested tamper rejection); Razorpay: X-Razorpay-Signature (unit-tested).                                                     |
| Idempotency keys                           | ✅             | Order/Payment/Refund/Loyalty entries unique-keyed; duplicate callbacks → 2xx no-op (live-tested).                                                                                  |
| Audit logs                                 | ✅             | Auth events, catalogue/branch/inventory mutations with actor + request id.                                                                                                         |
| IDOR / cross-branch access                 | ✅             | Order/receipt/payment reads gated by session possession token; inventory/dashboard branch-scoped; cashier denied refund approval (live-tested 403).                                |
| No card data                               | ✅             | No card fields anywhere; mock provider has no instruments; Razorpay runs on provider surfaces only.                                                                                |
| No sensitive data in logs                  | ✅             | Logging interceptor emits metadata only (no bodies); login failures log email only via audit.                                                                                      |

## Known gaps / before-production checklist

1. **bcrypt → Argon2id** (spec allows bcrypt; argon2 is the modern default).
2. **Redis-backed rate limiting + BullMQ** for multi-instance deployments
   (memory limiter is per-process).
3. **Loyalty EXPIRY + reservation reaper schedulers** need the Phase 6 queue
   (lazy expiry already correct; reaper is hygiene).
4. **Refresh-token rotation family detection** (reuse of a rotated token
   should revoke the whole family) — current rotation already invalidates the
   presented token atomically; family revocation is a hardening nicety.
5. **2FA/TOTP for admin accounts** — recommended for real deployments.
6. **HTTPS/HSTS** terminates at the platform (Vercel/container host) — add
   HSTS header in production config when the domain exists.
7. **Dependency audit** (`pnpm audit`) should gate CI once the dependency set
   stabilises.
8. **Postgres SSL** (`sslmode=require`) on managed databases; connection
   string supports it today.
