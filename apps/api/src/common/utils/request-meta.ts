import type { Request } from 'express';

/** Correlation metadata (request id from the middleware, client IP) for audit entries. */
export function requestMeta(request: Request): { ip?: string; requestId?: string } {
  return {
    ip: request.ip,
    requestId: (request as Request & { requestId?: string }).requestId,
  };
}
