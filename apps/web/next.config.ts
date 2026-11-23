import type { NextConfig } from 'next';

/**
 * API_ORIGIN (optional): where the NestJS API listens. When configured, Next
 * proxies /api/v1/* same-origin so refresh cookies stay first-party. When
 * omitted, Next serves the built-in in-memory demo API route handler instead.
 */
const apiOrigin = process.env.API_ORIGIN?.trim();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@quickcart/shared'],
  // Standalone output powers the Electron desktop distribution
  // (apps/desktop) — a self-contained server.js + minimal node_modules.
  output: 'standalone',
  async rewrites() {
    if (!apiOrigin) return [];
    return [{ source: '/api/v1/:path*', destination: `${apiOrigin}/api/v1/:path*` }];
  },
};

export default nextConfig;
