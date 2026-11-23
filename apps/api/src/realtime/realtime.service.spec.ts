import { jest, describe, expect, it, beforeAll } from '@jest/globals';
import { JwtService } from '@nestjs/jwt';
import { RealtimeService } from './realtime.service';

const JWT_SECRET = 'x'.repeat(48);

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET = JWT_SECRET;
  process.env.PAYMENT_WEBHOOK_SECRET = 'w'.repeat(48);
});

const staffUser = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'ACTIVE',
  branchId: '22222222-2222-4222-8222-222222222222',
  roles: [{ role: { name: 'CASHIER' } }],
};

const session = {
  sessionTokenHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  status: 'OPEN',
};

function makeService() {
  const jwt = {
    verifyAsync: jest
      .fn<(...args: unknown[]) => Promise<{ sub: string }>>()
      .mockResolvedValue({ sub: staffUser.id }),
  } as unknown as JwtService;
  const prisma = {
    user: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(staffUser),
    },
    checkoutSession: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(session),
    },
  };
  const service = new RealtimeService(jwt, prisma as never);
  return { service, jwt, prisma };
}

describe('RealtimeService.resolveIdentity — unauthorized attempts (spec §13)', () => {
  it('rejects sockets with no credentials at all', async () => {
    const { service } = makeService();
    await expect(service.resolveIdentity(undefined)).resolves.toBeNull();
    await expect(service.resolveIdentity({})).resolves.toBeNull();
  });

  it('rejects an invalid/staff-token forgery', async () => {
    const { service, jwt } = makeService();
    (
      jwt.verifyAsync as unknown as { mockRejectedValue: (v: unknown) => unknown }
    ).mockRejectedValue(new Error('jwt malformed'));
    await expect(service.resolveIdentity({ token: 'forged.token.value' })).resolves.toBeNull();
  });

  it('rejects staff whose account is disabled (live status check)', async () => {
    const { service, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ ...staffUser, status: 'DISABLED' });
    await expect(service.resolveIdentity({ token: 'a'.repeat(40) })).resolves.toBeNull();
  });

  it('rejects a customer session token that does not match the session', async () => {
    const { service, prisma } = makeService();
    prisma.checkoutSession.findUnique.mockResolvedValue({
      ...session,
      sessionTokenHash: '0'.repeat(64),
    });
    // sessionTokenMatches hashes the presented token — a random one mismatches.
    await expect(
      service.resolveIdentity({ sessionToken: 'not-the-real-token-1234567890', sessionId: 's1' }),
    ).resolves.toBeNull();
  });

  it('rejects session auth without a sessionId', async () => {
    const { service } = makeService();
    await expect(
      service.resolveIdentity({ sessionToken: 'not-the-real-token-1234567890' }),
    ).resolves.toBeNull();
  });

  it('never resolves a room identity for a nonexistent session', async () => {
    const { service, prisma } = makeService();
    prisma.checkoutSession.findUnique.mockResolvedValue(null);
    await expect(
      service.resolveIdentity({ sessionToken: 'whatever-token-1234567890', sessionId: 's1' }),
    ).resolves.toBeNull();
  });
});

describe('RealtimeService.joinAuthorizedRooms', () => {
  function fakeSocket() {
    const joined: string[] = [];
    return { joined, join: (room: string) => joined.push(room) };
  }

  it('scopes branch staff to their branch + staff feed', async () => {
    const { service } = makeService();
    const socket = fakeSocket();
    await service.joinAuthorizedRooms(socket as never, {
      staff: { userId: staffUser.id, branchId: staffUser.branchId, roles: ['CASHIER'] },
    });
    expect(socket.joined).toEqual(['staff', `branch:${staffUser.branchId}`]);
  });

  it('gives admins every branch room (server-side decision, not client choice)', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
          ...staffUser,
          branchId: null,
          roles: [{ role: { name: 'ADMIN' } }],
        }),
      },
      checkoutSession: {
        findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
      },
      branch: {
        findMany: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]),
      },
    };
    const jwt = {
      verifyAsync: jest
        .fn<() => Promise<{ sub: string }>>()
        .mockResolvedValue({ sub: staffUser.id }),
    } as unknown as JwtService;
    const service = new RealtimeService(jwt, prisma as never);
    const socket = fakeSocket();
    await service.joinAuthorizedRooms(socket as never, {
      staff: { userId: staffUser.id, branchId: null, roles: ['ADMIN'] },
    });
    expect(socket.joined).toEqual(['staff', 'branch:b1', 'branch:b2']);
  });

  it('scopes a customer to exactly their own session room', async () => {
    const { service } = makeService();
    const socket = fakeSocket();
    await service.joinAuthorizedRooms(socket as never, { sessionId: 'sess-1' });
    expect(socket.joined).toEqual(['session:sess-1']);
  });
});
