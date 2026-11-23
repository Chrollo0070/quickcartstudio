import { ForbiddenException } from '@nestjs/common';
import { jest, describe, expect, it } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import type { AuthenticatedUser } from '../common/types/authenticated-user';

function makeContext(user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as unknown as ExecutionContext;
}

function makeGuard(meta: { roles?: string[]; permissions?: string[] }) {
  const reflector = {
    getAllAndOverride: jest.fn<(...args: unknown[]) => unknown>((key: unknown) =>
      key === 'requiredRoles' ? meta.roles : meta.permissions,
    ),
  } as unknown as Reflector;
  const prisma = {
    role: { findMany: jest.fn<() => Promise<unknown>>().mockResolvedValue([]) },
  };
  const guard = new RolesGuard(reflector, prisma as never);
  return { guard, prisma };
}

const staffUser: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'cashier@quickmart.dev',
  fullName: 'Demo Cashier',
  branchId: '22222222-2222-4222-8222-222222222222',
  roles: ['CASHIER'],
};

describe('RolesGuard', () => {
  it('allows routes without role/permission metadata', async () => {
    const { guard } = makeGuard({});
    await expect(guard.canActivate(makeContext(staffUser))).resolves.toBe(true);
  });

  it('rejects when the user lacks the required role', async () => {
    const { guard } = makeGuard({ roles: ['ADMIN'] });
    await expect(guard.canActivate(makeContext(staffUser))).rejects.toThrow(ForbiddenException);
  });

  it('accepts when the user holds one of the required roles', async () => {
    const { guard } = makeGuard({ roles: ['ADMIN', 'MANAGER'] });
    await expect(
      guard.canActivate(makeContext({ ...staffUser, roles: ['MANAGER'] })),
    ).resolves.toBe(true);
  });

  it('rejects unauthenticated requests that require permissions (guard-order bug guard)', async () => {
    const { guard } = makeGuard({ permissions: ['catalogue:write'] });
    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(/Not authenticated/);
  });

  it('grants access when the DB-backed permission set covers the requirement', async () => {
    const { guard, prisma } = makeGuard({ permissions: ['catalogue:write'] });
    prisma.role.findMany.mockResolvedValue([
      {
        permissions: [
          { permission: { key: 'catalogue:read' } },
          { permission: { key: 'catalogue:write' } },
        ],
      },
    ]);
    await expect(guard.canActivate(makeContext(staffUser))).resolves.toBe(true);
  });

  it('lists the missing permission keys in the rejection', async () => {
    const { guard } = makeGuard({ permissions: ['catalogue:write', 'users:manage'] });
    let caught: unknown;
    try {
      await guard.canActivate(makeContext(staffUser));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    const response = (caught as ForbiddenException).getResponse() as Record<string, unknown>;
    expect(response['code']).toBe('FORBIDDEN_PERMISSION');
    expect(response['missing']).toEqual(['catalogue:write', 'users:manage']);
  });
});
