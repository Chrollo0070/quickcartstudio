# ADR-005: pnpm workspaces + Turborepo; no heavier tooling

- **Status:** Accepted (Phase 0)
- **Context:** Two apps + two shared packages with a dependency graph
  (shared → api/web). The brief says: choose one monorepo tool, only with clear
  benefit.
- **Decision:** pnpm workspaces for package management (strict, content-
  addressable store, fast) and Turborepo for task orchestration
  (lint/typecheck/test/build with dependency order and caching). No Nx/Bazel.
- **Consequences:** `pnpm build` etc. run in correct order and cache. Each
  package declares the tools it executes (eslint binary, tsconfig deps) because
  pnpm is strict about resolution.
- **Pinned versions:** TypeScript ~5.9 (TS 7 just released; ts-jest requires
  <7), Prisma 7.10.1 stable (8.x is still RC at the time of writing), NestJS
  12.x (ESM-only — see ADR-006).
