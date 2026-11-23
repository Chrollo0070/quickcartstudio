/**
 * Per-route throttle descriptor. NODE_ENV=test scales limits up so E2E suites
 * (which share one source IP and hammer the same endpoints) are not throttled;
 * production behaviour is unchanged.
 */
export function routeThrottle(limit: number): { default: { limit: number; ttl: number } } {
  const multiplier = process.env.NODE_ENV === 'test' ? 50 : 1;
  return { default: { limit: limit * multiplier, ttl: 60_000 } };
}
