# ADR-002: Zod for validation everywhere; no class-validator

- **Status:** Accepted (Phase 0)
- **Context:** NestJS's default DTO story is class-validator + class-transformer.
  The stack brief also mandates Zod on the frontend (React Hook Form + Zod) and
  startup env validation.
- **Decision:** Use Zod as the single validation language: `ZodValidationPipe`
  for API inputs, `createEnv` for environment config, shared schemas for
  frontend forms. DTO _output_ classes (with `@ApiProperty`) remain the Swagger
  contract so we keep explicit, documented response shapes.
- **Consequences:** One library and one mental model; schemas are composable and
  type-inferring. Trade-off: Swagger input docs are wired per-route via the pipe
  rather than auto-generated from decorators; we document request shapes with
  `@ApiBody`/schemas as endpoints land.
- **Note:** `@typescript-eslint/consistent-type-imports` must not rewrite
  DI-injected class imports — `emitDecoratorMetadata` needs the runtime value.
  Exceptions are marked inline with a comment.
