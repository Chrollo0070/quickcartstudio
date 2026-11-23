import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration (replaces the package.json "prisma" block).
 * The CLI (migrate/generate/seed/studio) reads the connection URL from here —
 * schema files no longer carry datasource URLs in v7. Startup validation of
 * the full environment happens in src/config/env.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
