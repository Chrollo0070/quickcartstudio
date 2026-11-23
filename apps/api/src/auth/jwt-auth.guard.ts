import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

interface AccessPayload {
  sub: string;
  email: string;
}

/**
 * Global bearer-token guard. Verifies the JWT, then loads the live user from
 * the database on every authenticated request so disabled users and role
 * changes take effect immediately (the token itself carries no authority).
 * Health and login/refresh are skipped via @Public().
 */
@Injectable()
export class JwtAuthGuard {
  constructor(
    private readonly jwtService: JwtService,
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

    const request = context.switchToHttp().getRequest();
    const authHeader: unknown = request.headers['authorization'];
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice('Bearer '.length)
        : undefined;
    if (!token) {
      throw new UnauthorizedException({ message: 'Missing bearer token', code: 'NO_TOKEN' });
    }

    let payload: AccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<AccessPayload>(token);
    } catch {
      throw new UnauthorizedException({ message: 'Invalid or expired token', code: 'BAD_TOKEN' });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        branchId: true,
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ message: 'Account unavailable', code: 'USER_INACTIVE' });
    }

    const authenticated: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      branchId: user.branchId,
      roles: user.roles.map((r) => r.role.name),
    };
    request.user = authenticated;
    return true;
  }
}
