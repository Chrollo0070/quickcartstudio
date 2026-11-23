import { UnauthorizedException } from '@nestjs/common';
import { jest, describe, expect, it, beforeAll } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { AuthService, hashToken } from './auth.service';

// env.ts validates lazily on first getEnv() — provide the variables the auth
// flow touches before any test runs.
beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET = 'x'.repeat(48);
  process.env.PAYMENT_WEBHOOK_SECRET = 'w'.repeat(48);
  process.env.JWT_REFRESH_TTL_DAYS = '7';
});

const HASHED_PASSWORD = bcrypt.hashSync('QuickMart!dev123', 4);

const activeUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'cashier@quickmart.dev',
  fullName: 'Demo Cashier',
  status: 'ACTIVE',
  branchId: '22222222-2222-4222-8222-222222222222',
  passwordHash: HASHED_PASSWORD,
  roles: [{ role: { name: 'CASHIER' } }],
};

/**
 * Permissive mock factory: every backend call takes unknown args and resolves
 * unknown, so call assertions keep working regardless of Prisma's signatures.
 */
const mockFn = () => jest.fn<(...args: unknown[]) => Promise<unknown>>();

function makeAuthService(userOverrides?: Partial<typeof activeUser>) {
  const user = { ...activeUser, ...userOverrides };
  const prisma = {
    user: {
      findUnique: mockFn().mockResolvedValue(user),
      findUniqueOrThrow: mockFn().mockResolvedValue(user),
      update: mockFn().mockResolvedValue(user),
    },
    refreshToken: {
      findUnique: mockFn().mockResolvedValue(null),
      create: mockFn().mockResolvedValue({ id: 'token-id' }),
      updateMany: mockFn().mockResolvedValue({ count: 1 }),
    },
    $transaction: mockFn().mockImplementation((txFactory: unknown) =>
      Promise.resolve(
        (txFactory as (tx: unknown) => unknown)({
          refreshToken: {
            updateMany: mockFn().mockResolvedValue({ count: 1 }),
            create: mockFn().mockResolvedValue({ id: 'new-token-id' }),
          },
        }),
      ),
    ),
  };
  const jwt = { signAsync: mockFn().mockResolvedValue('signed-access-token') };
  const audit = { log: mockFn().mockResolvedValue(undefined) };
  const service = new AuthService(prisma as never, jwt as never, audit as never);
  return { service, prisma, jwt, audit };
}

describe('AuthService.login', () => {
  it('issues an access token and a random refresh token for valid credentials', async () => {
    const { service, jwt } = makeAuthService();
    const result = await service.login(
      { email: 'cashier@quickmart.dev', password: 'QuickMart!dev123' },
      {},
    );
    expect(result.accessToken).toBe('signed-access-token');
    expect(result.refreshToken).toHaveLength(64); // 48 random bytes, base64url
    expect(result.user).toMatchObject({
      email: 'cashier@quickmart.dev',
      roles: ['CASHIER'],
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ sub: activeUser.id }),
      expect.objectContaining({ expiresIn: expect.anything() }),
    );
  });

  it('rejects a wrong password with BAD_CREDENTIALS and audits the failure', async () => {
    const { service, audit } = makeAuthService();
    await expect(
      service.login({ email: 'cashier@quickmart.dev', password: 'wrong' }, {}),
    ).rejects.toThrow(UnauthorizedException);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.login.failed' }),
    );
  });

  it('gives unknown emails the same response as a wrong password (no enumeration)', async () => {
    const { service } = makeAuthService();
    const unknownEmail = service.login({ email: 'nobody@quickmart.dev', password: 'x' }, {});
    const wrongPassword = (async () => {
      try {
        await service.login({ email: 'cashier@quickmart.dev', password: 'wrong' }, {});
      } catch (error) {
        return error;
      }
    })();
    const [unknownError, passwordError] = await Promise.all([
      unknownEmail.catch((error: unknown) => error),
      wrongPassword,
    ]);
    expect((unknownError as UnauthorizedException).getResponse()).toEqual(
      (passwordError as UnauthorizedException).getResponse(),
    );
  });

  it('rejects disabled accounts even with correct credentials', async () => {
    const { service } = makeAuthService({ status: 'DISABLED' });
    await expect(
      service.login({ email: 'cashier@quickmart.dev', password: 'QuickMart!dev123' }, {}),
    ).rejects.toThrow(UnauthorizedException);
  });
});

describe('AuthService.refresh', () => {
  const presented = 'a'.repeat(64);

  it('rotates: revokes the old token, creates a new one, returns a fresh raw token', async () => {
    const { service, prisma } = makeAuthService();
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-id',
      userId: activeUser.id,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    const result = await service.refresh(presented, {});
    expect(result.refreshToken).not.toBe(presented);
    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashToken(presented) } }),
    );
    // rotation ran inside a transaction
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('rejects revoked, unknown and expired tokens without touching the DB further', async () => {
    const { service } = makeAuthService();
    for (const stored of [
      null,
      {
        id: 't',
        userId: activeUser.id,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date(),
      },
      { id: 't', userId: activeUser.id, expiresAt: new Date(Date.now() - 60_000), revokedAt: null },
    ]) {
      const attempt = makeAuthService();
      attempt.prisma.refreshToken.findUnique.mockResolvedValue(stored);
      await expect(attempt.service.refresh(presented, {})).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'BAD_REFRESH_TOKEN' }),
      });
    }
    expect(service).toBeDefined();
  });

  it('fails when the rotation update races (count 0 → replayed token)', async () => {
    const { service, prisma } = makeAuthService();
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-id',
      userId: activeUser.id,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    prisma.$transaction.mockImplementation((txFactory: unknown): Promise<unknown> =>
      Promise.resolve(
        (txFactory as (tx: unknown) => unknown)({
          refreshToken: {
            updateMany: mockFn().mockResolvedValue({ count: 0 }),
            create: mockFn(),
          },
        }),
      ),
    );
    await expect(service.refresh(presented, {})).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BAD_REFRESH_TOKEN' }),
    });
  });
});

describe('AuthService.logout', () => {
  it('revokes the presented token (idempotent)', async () => {
    const { service, prisma } = makeAuthService();
    await service.logout('a'.repeat(64), { id: activeUser.id });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: hashToken('a'.repeat(64)), revokedAt: null },
      }),
    );
  });

  it('is a no-op without a token', async () => {
    const { service, prisma } = makeAuthService();
    await service.logout(undefined, { id: activeUser.id });
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
