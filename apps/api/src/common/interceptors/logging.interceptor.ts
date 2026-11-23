import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap, type Observable } from 'rxjs';

/**
 * Structured request logging (spec §2): one JSON line per request with the
 * correlation request id, duration and actor — never request/response bodies
 * (no PII or payment data in logs, spec §16).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, response, started),
        error: (error: { status?: number }) => {
          response.statusCode = error?.status ?? response.statusCode;
          this.log(request, response, started, error?.status);
        },
      }),
    );
  }

  private log(request: Request, response: Response, started: number, forcedStatus?: number): void {
    const status = forcedStatus ?? response.statusCode;
    const user = (request as Request & { user?: { id?: string } }).user;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      method: request.method,
      path: request.originalUrl,
      status,
      durationMs: Date.now() - started,
      requestId: (request as Request & { requestId?: string }).requestId,
      userId: user?.id ?? null,
      ip: request.ip,
    });
    if (status >= 500) {
      this.logger.error(line);
    } else if (status >= 400) {
      this.logger.warn(line);
    } else {
      this.logger.log(line);
    }
  }
}
