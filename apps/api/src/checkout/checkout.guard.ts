import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { sessionTokenMatches } from './session-token.util';

/**
 * Route guard for customer checkout endpoints. The customer proves ownership
 * of the session by presenting the token received at creation time in the
 * `x-session-token` header — possession of the hash preimage IS the auth.
 * Session creation is @Public() (there is no session yet); staff-owned (POS)
 * sessions created in Phase 4 will attach a JWT instead.
 */
@Injectable()
export class CheckoutSessionGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers['x-session-token'];
    const sessionId =
      (request.params as Record<string, string | undefined>)?.['id'] ??
      (request.body as { sessionId?: string } | undefined)?.sessionId;

    if (typeof token !== 'string' || token.length < 20 || !sessionId) {
      throw new UnauthorizedException({
        message: 'Missing checkout session credentials',
        code: 'NO_SESSION_TOKEN',
      });
    }

    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      select: { id: true, sessionTokenHash: true, status: true, branchId: true, channel: true },
    });
    if (!session?.sessionTokenHash || !sessionTokenMatches(token, session.sessionTokenHash)) {
      throw new UnauthorizedException({
        message: 'Invalid checkout session credentials',
        code: 'BAD_SESSION_TOKEN',
      });
    }
    // Expiry itself is enforced by the service (lazy transition + release).
    (request as Request & { checkoutSession: typeof session }).checkoutSession = session;
    return true;
  }
}
