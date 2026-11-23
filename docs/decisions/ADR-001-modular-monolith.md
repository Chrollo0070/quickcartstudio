# ADR-001: Modular monolith (NestJS), not microservices

- **Status:** Accepted (Phase 0)
- **Context:** The product needs checkout, orders, payments, inventory, POS,
  dashboards and real-time updates. The brief explicitly asks for a modular
  monolith to start.
- **Decision:** One NestJS application (`apps/api`) with one module per domain
  and a global `PrismaModule`. Cross-domain work happens through injected
  services, not HTTP calls. Socket.IO and BullMQ live in the same process until
  scale demands otherwise.
- **Consequences:** Simplest deploy/test story; shared transaction scope for the
  checkout→order→stock critical path (a genuine correctness win). If we ever
  split, the seams are the module boundaries — pricing/inventory being the most
  likely extraction.
