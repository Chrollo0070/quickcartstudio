import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sessionTokenMatches } from '../checkout/session-token.util';
import type { ConfirmReceiptPayload } from '../payments/receipt.util';

const errors = {
  orderNotFound: () =>
    new NotFoundException({ message: 'Order not found', code: 'ORDER_NOT_FOUND' }),
  accessDenied: () =>
    new ForbiddenException({
      message: 'Order does not belong to this checkout session',
      code: 'ORDER_ACCESS_DENIED',
    }),
};

/**
 * Order reads with customer (session-token) ownership checks. Staff-facing
 * order lists/dashboards arrive with the POS/analytics phases.
 */
@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Assert the presented checkout-session token owns this order. */
  async assertSessionOwnsOrder(orderId: string, rawToken: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { session: { select: { sessionTokenHash: true } } },
    });
    if (!order) throw errors.orderNotFound();
    const tokenHash = order.session?.sessionTokenHash;
    if (!tokenHash || !sessionTokenMatches(rawToken, tokenHash)) {
      throw errors.accessDenied();
    }
  }

  async getOrder(orderId: string, rawToken: string): Promise<unknown> {
    await this.assertSessionOwnsOrder(orderId, rawToken);
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        currency: true,
        subtotal: true,
        taxTotal: true,
        grandTotal: true,
        placedAt: true,
        completedAt: true,
        payments: {
          select: { id: true, provider: true, status: true, failureReason: true },
          orderBy: { requestedAt: 'desc' },
          take: 1,
        },
        items: {
          select: { id: true, name: true, quantity: true, unit: true, lineTotal: true },
        },
      },
    });
    return order;
  }

  async getReceipt(orderId: string, rawToken: string): Promise<unknown> {
    await this.assertSessionOwnsOrder(orderId, rawToken);
    const receipt = await this.prisma.receipt.findUnique({
      where: { orderId },
      select: { number: true, issuedAt: true, payload: true },
    });
    if (!receipt) {
      throw new NotFoundException({ message: 'Receipt not issued yet', code: 'RECEIPT_NOT_FOUND' });
    }
    return {
      invoiceNumber: receipt.number,
      issuedAt: receipt.issuedAt.toISOString(),
      payload: receipt.payload as unknown as ConfirmReceiptPayload,
    };
  }
}
