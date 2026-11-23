import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Possession-based auth for anonymous self-checkout sessions: the raw token
 * exists only with the customer's browser; the DB stores its SHA-256.
 */
export function generateSessionToken(): { raw: string; tokenHash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, tokenHash: hashSessionToken(raw) };
}

export function hashSessionToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function sessionTokenMatches(raw: string, tokenHash: string): boolean {
  const presented = Buffer.from(hashSessionToken(raw));
  const stored = Buffer.from(tokenHash);
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
