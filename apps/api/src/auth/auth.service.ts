import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getEnv, accessTokenTtl } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import type { LoginInput } from './dto';

/** Cookie used to carry the rotating refresh token for browser clients. */
export const REFRESH_COOKIE = 'qc_refresh';

const SELECT_USER_WITH_ROLES = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  branchId: true,
  passwordHash: true,
  roles: { select: { role: { select: { name: true } } } },
} as const;

type UserWithRoles = {
  id: string;
  email: string;
  fullName: string;
  status: string;
  branchId: string | null;
  passwordHash: string;
  roles: Array<{ role: { name: string } }>;
};

function toAuthUser(user: UserWithRoles): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    branchId: user.branchId,
    roles: user.roles.map((r) => r.role.name),
  };
}

/** The database stores only SHA-256 hashes of refresh tokens. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function newRefreshToken(): { raw: string; tokenHash: string; expiresAt: Date } {
  const raw = randomBytes(48).toString('base64url');
  return {
    raw,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + getEnv().JWT_REFRESH_TTL_DAYS * 86_400_000),
  };
}

const BAD_REFRESH = () =>
  new UnauthorizedException({
    message: 'Refresh token invalid or expired',
    code: 'BAD_REFRESH_TOKEN',
  });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Verify credentials and start a session: short-lived access JWT + a rotating
   * refresh token (random, stored hashed). Audit failures without leaking
   * whether the email exists.
   */
  async login(
    input: LoginInput,
    meta: { ip?: string; requestId?: string },
  ): Promise<{ accessToken: string; user: AuthenticatedUser; refreshToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email.toLowerCase() },
      select: SELECT_USER_WITH_ROLES,
    });
    const passwordOk = user !== null && (await bcrypt.compare(input.password, user.passwordHash));

    if (!user || !passwordOk || user.status !== 'ACTIVE') {
      // Identical error and audit trail for unknown email and wrong password.
      await this.audit
        .log({
          actorUserId: user?.id ?? null,
          action: 'auth.login.failed',
          entityType: 'User',
          entityId: user?.id ?? null,
          metadata: { email: input.email },
          ip: meta.ip,
          requestId: meta.requestId,
        })
        .catch(() => undefined);
      throw new UnauthorizedException({ message: 'Invalid credentials', code: 'BAD_CREDENTIALS' });
    }

    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.issueRefreshToken(user.id);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit
      .log({
        actorUserId: user.id,
        action: 'auth.login',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        requestId: meta.requestId,
      })
      .catch(() => undefined);

    return { accessToken, user: toAuthUser(user), refreshToken };
  }

  /**
   * Rotate a refresh token: the presented token must exist, be unrevoked and
   * unexpired. Revocation of the old token and creation of the new one happen
   * in one transaction, so a replayed refresh fails; a stolen token stops
   * working as soon as the legitimate client refreshes.
   */
  async refresh(
    presentedToken: string,
    meta: { ip?: string; requestId?: string },
  ): Promise<{ accessToken: string; user: AuthenticatedUser; refreshToken: string }> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(presentedToken) },
      select: { id: true, userId: true, expiresAt: true, revokedAt: true },
    });
    if (!stored || stored.revokedAt !== null || stored.expiresAt.getTime() <= Date.now()) {
      throw BAD_REFRESH();
    }

    const next = newRefreshToken();
    await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        throw BAD_REFRESH();
      }
      await tx.refreshToken.create({
        data: {
          userId: stored.userId,
          tokenHash: next.tokenHash,
          expiresAt: next.expiresAt,
        },
      });
    });

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: stored.userId },
      select: SELECT_USER_WITH_ROLES,
    });
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({ message: 'Account unavailable', code: 'USER_INACTIVE' });
    }

    await this.audit
      .log({
        actorUserId: user.id,
        action: 'auth.token.refreshed',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        requestId: meta.requestId,
      })
      .catch(() => undefined);

    return {
      accessToken: await this.signAccessToken(user),
      user: toAuthUser(user),
      refreshToken: next.raw,
    };
  }

  /** Revoke a presented refresh token (idempotent). */
  async logout(
    presentedToken: string | undefined,
    actor: { id: string; ip?: string; requestId?: string },
  ): Promise<void> {
    if (!presentedToken) {
      return;
    }
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(presentedToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit
      .log({
        actorUserId: actor.id,
        action: 'auth.logout',
        entityType: 'User',
        entityId: actor.id,
        ip: actor.ip,
        requestId: actor.requestId,
      })
      .catch(() => undefined);
  }

  private async signAccessToken(user: UserWithRoles): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id, email: user.email },
      { expiresIn: accessTokenTtl() },
    );
  }

  /** Profile for GET /users/me: live roles, permission keys and home branch. */
  async getMe(userId: string): Promise<{
    id: string;
    email: string;
    fullName: string;
    branchId: string | null;
    roles: string[];
    permissions: string[];
    branch: { id: string; code: string; name: string } | null;
    lastLoginAt: string | null;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        branchId: true,
        lastLoginAt: true,
        roles: {
          select: {
            role: {
              select: {
                name: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        },
        branch: { select: { id: true, code: true, name: true } },
      },
    });
    const roles: string[] = [];
    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      roles.push(userRole.role.name);
      for (const rp of userRole.role.permissions) {
        permissions.add(rp.permission.key);
      }
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      branchId: user.branchId,
      roles,
      permissions: [...permissions].sort(),
      branch: user.branch,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    };
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const token = newRefreshToken();
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: token.tokenHash, expiresAt: token.expiresAt },
    });
    return token.raw;
  }
}
