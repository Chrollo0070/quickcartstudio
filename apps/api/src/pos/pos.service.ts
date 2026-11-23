import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckoutService } from '../checkout/checkout.service';
import { PaymentsService } from '../payments/payments.service';
import { RealtimeService } from '../realtime/realtime.service';
import { randomUUID } from 'node:crypto';

const errors = {
  orderNotFound: () =>
    new NotFoundException({ message: 'Order not found', code: 'ORDER_NOT_FOUND' }),
  refundNotFound: () =>
    new NotFoundException({ message: 'Refund not found', code: 'REFUND_NOT_FOUND' }),
  refundState: (status: string) =>
    new ConflictException({ message: `Refund is ${status}`, code: 'REFUND_CLOSED' }),
  refundExceeds: () =>
    new ConflictException({
      message: 'Refund exceeds the refundable amount',
      code: 'REFUND_EXCEEDS',
    }),
  shiftOpen: () =>
    new ConflictException({ message: 'Cashier already has an open shift', code: 'SHIFT_OPEN' }),
  shiftNotFound: () =>
    new NotFoundException({ message: 'Shift not found', code: 'SHIFT_NOT_FOUND' }),
  shiftClosed: () =>
    new ConflictException({ message: 'Shift is already closed', code: 'SHIFT_CLOSED' }),
};

export interface OperatorIdentity {
  id: string;
  branchId: string | null;
}

/**
 * Staff POS operations. Everything reuses the shared checkout domain — POS is
 * a channel, not a second stock system (architecture.md §3). Unlike
 * self-checkout, POS scans check availability WITHOUT reserving: the
 * completion transaction's conditional decrement is the oversell guard
 * (ADR-004) and register flow is fast.
 */
@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly payments: PaymentsService,
    private readonly realtime: RealtimeService,
  ) {}

  async createSession(operator: OperatorIdentity, branchId: string | null): Promise<unknown> {
    const branchIdResolved = branchId ?? operator.branchId;
    if (!branchIdResolved) {
      throw new ConflictException({
        message: 'No branch resolved for the operator',
        code: 'BRANCH_REQUIRED',
      });
    }
    const session = await this.checkout.createOperatorSession(branchIdResolved, operator.id);
    return session;
  }

  async listSessions(operator: OperatorIdentity): Promise<unknown> {
    const branchId = operator.branchId;
    if (!branchId) {
      // Platform admins see every branch's parked sales.
      const sessions = await this.prisma.checkoutSession.findMany({
        where: { channel: 'POS', status: { in: ['OPEN', 'SUSPENDED'] } },
        select: { id: true, status: true, branchId: true, updatedAt: true },
        orderBy: { updatedAt: 'desc' },
        take: 20,
      });
      return sessions;
    }
    const sessions = await this.prisma.checkoutSession.findMany({
      where: { channel: 'POS', branchId, status: { in: ['OPEN', 'SUSPENDED'] } },
      select: { id: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    return sessions;
  }

  async suspendSession(sessionId: string): Promise<unknown> {
    await this.checkout.setSuspended(sessionId, true);
    return { sessionId, status: 'SUSPENDED' };
  }

  async resumeSession(sessionId: string): Promise<unknown> {
    // Resume revalidates prices by rebuilding the quote (stale-cart protection).
    await this.checkout.setSuspended(sessionId, false);
    return this.checkout.getSession(sessionId);
  }

  /**
   * Complete a POS sale: confirm (revalidated quote, PENDING_PAYMENT order) →
   * immediate settlement (cash counted, or the mock provider's verified path)
   * → COMPLETED + receipt. One idempotency key spans the whole completion.
   */
  async complete(
    sessionId: string,
    input: { paymentMethod: 'CASH' | 'MOCK'; idempotencyKey: string; expectedQuoteHash?: string },
    operator: OperatorIdentity,
  ): Promise<unknown> {
    const confirmed = (await this.checkout.confirm(sessionId, {
      idempotencyKey: input.idempotencyKey,
      expectedQuoteHash: input.expectedQuoteHash,
    })) as { orderId: string; status: string; retry?: boolean };

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: confirmed.orderId },
      select: { id: true, status: true, grandTotal: true, currency: true, shiftId: true },
    });

    // Attach the operator's open shift (cash drawer accountability).
    let shiftId: string | null = order.shiftId;
    if (!shiftId) {
      const shift = await this.prisma.cashierShift.findFirst({
        where: { cashierUserId: operator.id, status: 'OPEN' },
        select: { id: true },
      });
      if (shift) {
        await this.prisma.order.update({ where: { id: order.id }, data: { shiftId: shift.id } });
        shiftId = shift.id;
      }
    }

    if (order.status === 'COMPLETED') {
      // Idempotent retry after a completed sale.
      return { orderId: order.id, status: order.status, retry: true, shiftId };
    }

    const providerRef =
      input.paymentMethod === 'CASH' ? `cash_${randomUUID()}` : `mock_${randomUUID()}`;
    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: input.paymentMethod,
        providerRef,
        method: input.paymentMethod === 'CASH' ? 'cash' : 'mock',
        amount: order.grandTotal,
        currency: order.currency,
        status: 'INITIATED',
        idempotencyKey: input.idempotencyKey,
      },
      select: { id: true, providerRef: true },
    });

    const settled = (await this.payments.settleByProviderRef(
      input.paymentMethod,
      payment.providerRef!,
    )) as { receiptNumber?: string; duplicate?: boolean };

    return {
      orderId: order.id,
      status: 'COMPLETED',
      paymentId: payment.id,
      receiptNumber: settled.receiptNumber,
      shiftId,
      retry: confirmed.retry ?? false,
    };
  }

  async openShift(operator: OperatorIdentity, openingCash: string): Promise<unknown> {
    const existing = await this.prisma.cashierShift.findFirst({
      where: { cashierUserId: operator.id, status: 'OPEN' },
      select: { id: true },
    });
    if (existing) throw errors.shiftOpen();
    const shift = await this.prisma.cashierShift.create({
      data: {
        branchId: operator.branchId!,
        cashierUserId: operator.id,
        openingCash,
        status: 'OPEN',
      },
    });
    return { shiftId: shift.id, status: 'OPEN', openingCash: shift.openingCash.toString() };
  }

  /** Current shift + cash-drawer summary derived from real orders. */
  async currentShift(operator: OperatorIdentity): Promise<unknown> {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { cashierUserId: operator.id, status: 'OPEN' },
    });
    if (!shift) {
      return { shift: null };
    }
    const orders = await this.prisma.order.findMany({
      where: { shiftId: shift.id, status: 'COMPLETED' },
      select: { grandTotal: true, payments: { select: { provider: true, method: true } } },
    });
    const cashSales = orders.filter((o) =>
      o.payments.some((p) => p.provider === 'CASH' || p.method === 'cash'),
    );
    const cashTotal = cashSales.reduce((sum, o) => sum.plus(o.grandTotal), new Prisma.Decimal(0));
    return {
      shift: {
        id: shift.id,
        openedAt: shift.openedAt.toISOString(),
        openingCash: shift.openingCash.toString(),
        orders: orders.length,
        cashOrders: cashSales.length,
        cashCollected: cashTotal.toString(),
        expectedDrawer: cashTotal.plus(shift.openingCash).toString(),
      },
    };
  }

  async closeShift(operator: OperatorIdentity, closingCash: string): Promise<unknown> {
    const shift = await this.prisma.cashierShift.findFirst({
      where: { cashierUserId: operator.id, status: 'OPEN' },
    });
    if (!shift) throw errors.shiftNotFound();
    const summary = (await this.currentShift(operator)) as {
      shift: { cashCollected: string; expectedDrawer: string; orders: number } | null;
    };
    await this.prisma.cashierShift.update({
      where: { id: shift.id },
      data: { status: 'CLOSED', closedAt: new Date(), closingCash },
    });
    return {
      shiftId: shift.id,
      status: 'CLOSED',
      summary: summary.shift,
      closingCash,
    };
  }

  /**
   * Refunds: full-order MVP. Cashiers request (`REQUESTED`), managers approve
   * → `COMPLETED` with RETURN movements restoring stock. The refund amount is
   * the order grand total; partial-amount allocation lands with Phase 5
   * loyalty/reconciliation work.
   */
  async requestRefund(
    orderId: string,
    reason: string,
    requestedBy: OperatorIdentity,
    idempotencyKey: string,
  ): Promise<unknown> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        grandTotal: true,
        refunds: {
          where: { status: { in: ['REQUESTED', 'APPROVED', 'COMPLETED'] } },
          select: { id: true },
        },
      },
    });
    if (!order) throw errors.orderNotFound();
    if (order.status !== 'COMPLETED' && order.status !== 'PARTIALLY_REFUNDED') {
      throw new ConflictException({
        message: 'Only completed orders can be refunded',
        code: 'ORDER_NOT_REFUNDABLE',
      });
    }
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return { refundId: existing.id, status: existing.status, retry: true };
    }
    if (order.refunds.length > 0) {
      throw errors.refundExceeds(); // MVP: one full refund per order
    }
    const refund = await this.prisma.refund.create({
      data: {
        orderId,
        paymentId: (
          await this.prisma.payment.findFirstOrThrow({
            where: { orderId, status: 'SUCCEEDED' },
            select: { id: true },
          })
        ).id,
        amount: order.grandTotal,
        currency: 'INR',
        reason,
        status: 'REQUESTED',
        requestedByUserId: requestedBy.id,
        idempotencyKey,
      },
      select: { id: true, status: true },
    });
    return { refundId: refund.id, status: refund.status };
  }

  async listPendingRefunds(): Promise<unknown> {
    const refunds = await this.prisma.refund.findMany({
      where: { status: 'REQUESTED' },
      select: {
        id: true,
        orderId: true,
        amount: true,
        currency: true,
        reason: true,
        requestedAt: true,
        order: { select: { branchId: true, grandTotal: true, channel: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 20,
    });
    return refunds.map((r) => ({
      refundId: r.id,
      orderId: r.orderId,
      amount: r.amount.toString(),
      currency: r.currency,
      reason: r.reason,
      requestedAt: r.requestedAt.toISOString(),
    }));
  }

  /** Approval completes the refund and reverses stock in one transaction. */
  async approveRefund(refundId: string, approver: OperatorIdentity): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({
        where: { id: refundId },
        include: { order: { include: { items: true } } },
      });
      if (!refund) throw errors.refundNotFound();
      if (refund.status !== 'REQUESTED') throw errors.refundState(refund.status);

      for (const item of refund.order.items) {
        const restored = await tx.$executeRaw`
          UPDATE "InventoryBalance"
          SET "onHand" = "onHand" + ${item.quantity}, "updatedAt" = now()
          WHERE "branchId" = ${refund.order.branchId}::uuid AND "productId" = ${item.productId}::uuid`;
        if (restored !== 1) {
          throw new ConflictException({ code: 'STOCK_RACE' });
        }
        await tx.stockMovement.create({
          data: {
            branchId: refund.order.branchId,
            productId: item.productId,
            type: 'RETURN',
            quantity: item.quantity,
            reason: `Refund ${refund.id}: ${refund.reason}`,
            refType: 'refund',
            refId: refund.id,
            actorUserId: approver.id,
          },
        });
      }

      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: 'COMPLETED',
          approvedByUserId: approver.id,
          completedAt: new Date(),
        },
      });
      await tx.order.update({
        where: { id: refund.orderId },
        data: { status: 'FULLY_REFUNDED' },
      });
      this.realtime.inventoryChanged(refund.order.branchId, 'refund');
      return { refundId: refund.id, status: 'COMPLETED', orderId: refund.orderId };
    });
  }
}
