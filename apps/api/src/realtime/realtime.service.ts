import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { getEnv } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { sessionTokenMatches } from '../checkout/session-token.util';

/**
 * Socket room model (spec §13):
 *  - `staff` — every authenticated staff connection (order/activity feed)
 *  - `branch:{id}` — staff scoped to their home branch (admins: all branches)
 *  - `session:{id}` — the checkout session owner ONLY (possession token)
 *
 * The database stays the source of truth: events are coarse notifications
 * (IDs + totals), clients refetch authoritative state via REST on receipt
 * and on reconnect. Customers can never subscribe to another session.
 */

export interface SocketIdentity {
  staff?: { userId: string; branchId: string | null; roles: string[] };
  sessionId?: string;
}

@Injectable()
export class RealtimeService implements OnModuleDestroy {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  attachServer(server: Server): void {
    this.server = server;
  }

  onModuleDestroy(): void {
    this.server?.disconnectSockets(true);
    this.server = null;
  }

  /**
   * Resolve + authorize a connecting socket. Extracted as a pure-ish method
   * so the authorization matrix is unit-testable (spec §13 requires tests for
   * unauthorized room subscriptions).
   */
  async resolveIdentity(auth: Record<string, unknown> | undefined): Promise<SocketIdentity | null> {
    const staffToken = auth?.token;
    const sessionToken = auth?.sessionToken;

    if (typeof staffToken === 'string' && staffToken.length > 20) {
      try {
        const payload = await this.jwtService.verifyAsync<{ sub: string }>(staffToken, {
          secret: getEnv().JWT_ACCESS_SECRET,
        });
        const user = await this.prisma.user.findUnique({
          where: { id: payload.sub },
          select: {
            id: true,
            status: true,
            branchId: true,
            roles: { select: { role: { select: { name: true } } } },
          },
        });
        if (!user || user.status !== 'ACTIVE') return null;
        return {
          staff: {
            userId: user.id,
            branchId: user.branchId,
            roles: user.roles.map((r) => r.role.name),
          },
        };
      } catch (error) {
        this.logger.warn(`staff token verify failed: ${(error as Error).message}`);
        return null;
      }
    }

    if (typeof sessionToken === 'string' && sessionToken.length > 20) {
      const sessionId = auth?.sessionId;
      if (typeof sessionId !== 'string') return null;
      const session = await this.prisma.checkoutSession.findUnique({
        where: { id: sessionId },
        select: { sessionTokenHash: true, status: true },
      });
      if (
        !session?.sessionTokenHash ||
        !sessionTokenMatches(sessionToken, session.sessionTokenHash)
      ) {
        return null;
      }
      return { sessionId };
    }

    return null;
  }

  async joinAuthorizedRooms(socket: Socket, identity: SocketIdentity): Promise<void> {
    if (identity.staff) {
      void socket.join('staff');
      if (identity.staff.branchId) {
        void socket.join(`branch:${identity.staff.branchId}`);
      }
      if (identity.staff.roles.includes('ADMIN')) {
        // Admins observe every branch feed.
        const branches = await this.prisma.branch.findMany({ select: { id: true } });
        for (const branch of branches) {
          void socket.join(`branch:${branch.id}`);
        }
      }
    }
    if (identity.sessionId) {
      void socket.join(`session:${identity.sessionId}`);
    }
  }

  private emit(room: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(room).emit(event, payload);
  }

  /** Fired when a checkout session's cart changes (owner + branch staff). */
  sessionUpdated(sessionId: string, summary?: { items: number; total?: string }): void {
    this.emit(`session:${sessionId}`, 'checkout.session.updated', {
      sessionId,
      ...(summary ?? {}),
    });
  }

  /** Coarse inventory change notice — clients refetch authoritative balances. */
  inventoryChanged(branchId: string, productId: string): void {
    this.emit(`branch:${branchId}`, 'inventory.updated', { branchId, productId });
  }

  /** Order lifecycle events for dashboards and the POS activity feed. */
  orderCompleted(
    branchId: string,
    payload: { orderId: string; channel: string; grandTotal: string; receiptNumber?: string },
  ): void {
    this.emit(`branch:${branchId}`, 'order.completed', payload);
    this.emit('staff', 'activity.order', payload);
  }

  paymentUpdated(sessionId: string, payload: { paymentId: string; status: string }): void {
    this.emit(`session:${sessionId}`, 'payment.updated', payload);
  }

  lowStock(
    branchId: string,
    payload: { productId: string; available: string; threshold: string },
  ): void {
    this.emit(`branch:${branchId}`, 'alert.low_stock', payload);
  }
}
