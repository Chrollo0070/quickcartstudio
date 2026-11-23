import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Propagates (or mints) an X-Request-Id for every request so logs, responses
 * and later audit records can be correlated. Structured logging with request
 * IDs is a spec requirement (§2 Infrastructure and quality); the JSON logger
 * that consumes this value lands with the auth phase.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  const requestId =
    typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
      ? incoming
      : randomUUID();
  (req as Request & { requestId?: string }).requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
