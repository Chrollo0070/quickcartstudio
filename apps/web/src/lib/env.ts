import { z } from 'zod';

/**
 * Browser-safe environment validation. NEXT_PUBLIC_* variables are inlined at
 * build time by Next.js, so a malformed value must fail the build here.
 */
const urlSchema = z.url();

// Empty/omitted = same-origin: /api/v1/* is proxied by the Next server
// (next.config.ts rewrites) and cookies stay first-party — required for the
// refresh flow on mobile and in browsers that block third-party cookies.
const raw = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');

export const env = {
  API_BASE_URL: raw === '' ? '' : urlSchema.parse(raw).replace(/\/+$/, ''),
} as const;
