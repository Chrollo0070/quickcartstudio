import { z } from 'zod';
import type { JwtSignOptions } from '@nestjs/jwt';

/**
 * Startup-validated environment configuration (spec §16: "Environment
 * variables validated at startup"). The schema is the single source of truth
 * for every variable the API reads; boot fails fast with a readable report
 * when anything is missing or malformed.
 *
 * `createEnv` is exported separately so tests can exercise validation against
 * arbitrary sources without touching `process.env`.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  /** Redis becomes mandatory in Phase 3 (queues, rate limiting, sessions). */
  REDIS_URL: z.url().optional(),
  /** Secret used to sign access-token JWTs. Generate: `openssl rand -base64 48`. */
  JWT_ACCESS_SECRET: z.string().min(32),
  /** Access-token lifetime (e.g. "15m"). Keep short; refresh tokens rotate. */
  JWT_ACCESS_TTL: z.string().default('15m'),
  /** Refresh-token lifetime in days. Refresh tokens rotate on every use. */
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  /** HMAC secret for the mock payment provider's signed webhook callbacks. */
  PAYMENT_WEBHOOK_SECRET: z.string().min(32),
  /** Razorpay test-mode keys — optional; the adapter refuses to run without them. */
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;
export type LogLevel = Env['LOG_LEVEL'];

export function createEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

let cachedEnv: Env | undefined;

/**
 * Lazily validated singleton environment. Validation runs on first use
 * (bootstrap), so importing this module never throws — tests exercise
 * `createEnv` directly against synthetic sources.
 */
export function getEnv(): Env {
  cachedEnv ??= createEnv(process.env);
  return cachedEnv;
}

/**
 * Access-token TTL as jsonwebtoken's StringValue type (e.g. "15m").
 * env validation guarantees a well-formed span; the cast only narrows the
 * generic string for @nestjs/jwt's signature.
 */
export function accessTokenTtl(): JwtSignOptions['expiresIn'] {
  return getEnv().JWT_ACCESS_TTL as unknown as JwtSignOptions['expiresIn'];
}
