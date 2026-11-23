import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { MockPaymentProvider } from './mock-payment.provider';
import { RazorpayProvider } from './razorpay.provider';
import type { PaymentProvider, WebhookEvent } from './payment-provider.interface';
import type { ConfirmReceiptPayload } from './receipt.util';

type Tx = Prisma.TransactionClient;

const errors = {
  paymentNotFound: () =>
    new NotFoundException({ message: 'Payment not found', code: 'PAYMENT_NOT_FOUND' }),
  orderNotFound: () =>
    new NotFoundException({ message: 'Order not found', code: 'ORDER_NOT_FOUND' }),
  badWebhook: () =>
    new NotFoundException({ message: 'Unknown webhook payload', code: 'WEBHOOK_REJECTED' }),
  amountMismatch: () =>
    new ConflictException({ message: 'Webhook amount mismatch', code: 'AMOUNT_MISMATCH' }),
  paymentClosed: (status: string) =>
    new ConflictException({ message: `Payment is ${status}`, code: 'PAYMENT_CLOSED' }),
  stockRace: () =>
    new ConflictException({
      message: 'Stock moved between checkout and payment — refund flow required',
      code: 'STOCK_RACE',
    }),
};

/**
 * Payment orchestration and the single most safety-critical transaction in
 * the system: settlement (architecture.md §4.3). One transaction does:
 * duplicate-callback check → payment SUCCEEDED → order COMPLETED →
 * conditional onHand decrement per line (oversell guard) → FEFO batch
 * allocation → SALE ledger movements → reservation conversion → receipt.
 *
 * Webhook retries are no-ops (already-SUCCEEDED → 2xx, zero side effects).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providers: Record<string, PaymentProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly mockProvider: MockPaymentProvider,
    private readonly razorpayProvider: RazorpayProvider,
  ) {
    this.providers = {
      MOCK: this.mockProvider,
      RAZORPAY: this.razorpayProvider,
    };
  }

  /** Create a payment intent for a PENDING_PAYMENT order (customer flow). */
  async createIntent(orderId: string, idempotencyKey: string): Promise<unknown> {
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
      include: { order: { select: { id: true, status: true } } },
    });
    if (existing) {
      return {
        paymentId: existing.id,
        provider: existing.provider,
        providerRef: existing.providerRef,
        status: existing.status,
        orderId: existing.orderId,
        retry: true,
      };
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw errors.orderNotFound();
    if (order.status !== 'PENDING_PAYMENT') {
      throw errors.paymentClosed(order.status);
    }

    const provider = this.providerFor(order.channel === 'POS' ? 'MOCK' : 'MOCK');
    const intent = await provider.createIntent({
      orderId: order.id,
      amountMinor: this.paiseMinor(order.grandTotal),
      currency: order.currency,
      idempotencyKey,
      description: `QuickCart order ${order.id}`,
    });

    const payment = await this.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: provider.kind,
        providerRef: intent.providerRef,
        method: provider.kind === 'MOCK' ? 'mock' : null,
        amount: order.grandTotal,
        currency: order.currency,
        status: 'INITIATED',
        idempotencyKey,
      },
      select: { id: true, provider: true, providerRef: true, status: true, orderId: true },
    });

    return {
      paymentId: payment.id,
      provider: payment.provider,
      providerRef: payment.providerRef,
      status: payment.status,
      orderId: payment.orderId,
      clientPayload: intent.clientPayload,
    };
  }

  /**
   * Customer-facing demo settlement: server-side trusted (no client data is
   * trusted — the server constructs and processes the signed callback itself).
   * Ownership was verified by the controller (session token).
   */
  async mockSettle(paymentId: string): Promise<unknown> {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw errors.paymentNotFound();
    if (payment.provider !== 'MOCK') {
      throw new ServiceUnavailableException({
        message: 'mock-settle only applies to the MOCK provider',
        code: 'NOT_A_MOCK_PAYMENT',
      });
    }
    if (!payment.providerRef) {
      throw errors.paymentNotFound();
    }
    const signedBody = JSON.stringify({
      providerRef: payment.providerRef,
      outcome: 'SUCCEEDED',
      signature: MockPaymentProvider.signature(payment.providerRef, 'SUCCEEDED'),
    });
    const verification = await this.mockProvider.verifyWebhook({}, signedBody);
    if (!verification.verified || !verification.event) {
      throw errors.badWebhook();
    }
    return this.processWebhookEvent('MOCK', verification.event);
  }

  /** Webhook entrypoint: verify BEFORE touching the database. */
  async handleWebhook(
    providerKind: string,
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<unknown> {
    const provider = this.providers[providerKind];
    if (!provider) throw errors.badWebhook();
    const verification = await provider.verifyWebhook(headers, rawBody);
    if (!verification.verified || !verification.event) {
      throw errors.badWebhook();
    }
    return this.processWebhookEvent(providerKind as 'MOCK' | 'RAZORPAY', verification.event);
  }

  /** Non-settling status updates (failed/cancelled) — no stock involvement. */
  async markPaymentFailed(
    providerKind: 'MOCK' | 'RAZORPAY',
    providerRef: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.payment.updateMany({
      where: { provider: providerKind, providerRef, status: { in: ['INITIATED', 'PENDING'] } },
      data: { status: 'FAILED', failureReason: reason },
    });
    const payment = await this.prisma.payment.findFirst({
      where: { provider: providerKind, providerRef },
      select: { orderId: true },
    });
    if (payment) {
      await this.prisma.order.updateMany({
        where: { id: payment.orderId, status: 'PENDING_PAYMENT' },
        data: { status: 'FAILED' },
      });
    }
  }

  async getPayment(paymentId: string): Promise<unknown> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        orderId: true,
        provider: true,
        providerRef: true,
        status: true,
        amount: true,
        currency: true,
        method: true,
        requestedAt: true,
        settledAt: true,
        failureReason: true,
        order: { select: { id: true, status: true, grandTotal: true } },
      },
    });
    if (!payment) throw errors.paymentNotFound();
    return payment;
  }

  // -------------------------------------------------------------------------
  // settlement
  // -------------------------------------------------------------------------

  private async processWebhookEvent(
    providerKind: 'MOCK' | 'RAZORPAY',
    event: WebhookEvent,
  ): Promise<unknown> {
    if (event.outcome === 'FAILED') {
      await this.markPaymentFailed(
        providerKind,
        event.providerRef,
        event.failureReason ?? 'Payment failed',
      );
      return { processed: true, settled: false, status: 'FAILED' };
    }
    if (event.outcome === 'CANCELLED') {
      await this.markPaymentFailed(providerKind, event.providerRef, 'Payment cancelled');
      return { processed: true, settled: false, status: 'CANCELLED' };
    }
    return this.settleByProviderRef(providerKind, event.providerRef, event.amountMinor);
  }

  /** Public for POS cash/mock immediate settlement; webhooks route through processWebhookEvent. */
  async settleByProviderRef(
    providerKind: 'MOCK' | 'RAZORPAY' | 'CASH',
    providerRef: string,
    reportedAmountMinor?: number,
  ): Promise<unknown> {
    const result = await this.prisma.$transaction(
      async (tx) => {
        const payment = await tx.payment.findUnique({
          where: { provider_providerRef: { provider: providerKind, providerRef } },
        });
        if (!payment) throw errors.paymentNotFound();

        // Duplicate callback / webhook retry: settle exactly once.
        if (payment.status === 'SUCCEEDED') {
          return { processed: true, settled: true, duplicate: true, orderId: payment.orderId };
        }
        if (payment.status !== 'INITIATED' && payment.status !== 'PENDING') {
          throw errors.paymentClosed(payment.status);
        }

        const order = await tx.order.findUnique({
          where: { id: payment.orderId },
          include: { items: { include: { taxLines: true } } },
        });
        if (!order) throw errors.orderNotFound();

        const reported = reportedAmountMinor ?? this.paiseMinor(payment.amount);
        if (reported !== this.paiseMinor(payment.amount)) {
          throw errors.amountMismatch();
        }

        // Stock: conditional decrement + FEFO batch allocation + ledger.
        for (const item of order.items) {
          const decremented = await tx.$executeRaw`
            UPDATE "InventoryBalance"
            SET "onHand" = "onHand" - ${item.quantity}, "updatedAt" = now()
            WHERE "branchId" = ${order.branchId}::uuid AND "productId" = ${item.productId}::uuid
              AND "onHand" >= ${item.quantity}`;
          if (decremented !== 1) {
            // Reservations should make this unreachable; if it happens, the
            // transaction rolls back and the payment stays unsettled.
            this.logger.error(`STOCK_RACE order ${order.id} item ${item.id}`);
            throw errors.stockRace();
          }
          // FEFO allocation writes its own batch-linked SALE movements and
          // returns the covered quantity; a plain movement only records the
          // remainder (stock without batch tracking). Together they sum to
          // exactly the sold quantity — the ledger never double-counts.
          const allocated = await this.allocateBatchesFefo(
            tx,
            order.branchId,
            item.productId,
            item.quantity,
            order.id,
          );
          const remainder = item.quantity.minus(allocated);
          if (remainder.greaterThan(0)) {
            await tx.stockMovement.create({
              data: {
                branchId: order.branchId,
                productId: item.productId,
                type: 'SALE',
                quantity: remainder.negated(),
                reason: `Order ${order.id}`,
                refType: 'order',
                refId: order.id,
              },
            });
          }
          // Reservation conversion: the held stock leaves `reserved` as the
          // SALE movement records the onHand drop (ADR-004).
          if (order.sessionId) {
            await tx.stockReservation.updateMany({
              where: { sessionId: order.sessionId, productId: item.productId, status: 'ACTIVE' },
              data: { status: 'CONVERTED' },
            });
            await tx.$executeRaw`
              UPDATE "InventoryBalance"
              SET "reserved" = GREATEST(0, "reserved" - ${item.quantity}), "updatedAt" = now()
              WHERE "branchId" = ${order.branchId}::uuid AND "productId" = ${item.productId}::uuid`;
          }
        }

        await tx.payment.update({
          where: { id: payment.id },
          data: { status: 'SUCCEEDED', settledAt: new Date() },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });

        const receipt = await this.createReceipt(tx, order, payment);

        // Loyalty earn (spec §12): floor(grandTotal × earnRate) for orders with
        // a customer; the idempotency key prevents double-earning even if a
        // retried webhook reached a not-yet-settled payment.
        if (order.customerId) {
          const settings = await tx.storeSettings.findUnique({
            where: { branchId: order.branchId },
          });
          const earnRate = settings?.loyaltyEarnRate ?? new Prisma.Decimal(0);
          const points = Math.floor(Number(order.grandTotal.times(earnRate).toFixed(4)));
          if (points > 0) {
            const account = await tx.loyaltyAccount.findUnique({
              where: { customerId: order.customerId },
            });
            if (account) {
              const balanceAfter = account.points + points;
              await tx.loyaltyAccount.update({
                where: { id: account.id },
                data: { points: { increment: points }, lifetimeEarned: { increment: points } },
              });
              await tx.loyaltyLedgerEntry.create({
                data: {
                  accountId: account.id,
                  type: 'EARN',
                  pointsDelta: points,
                  balanceAfter,
                  idempotencyKey: 'earn:order:' + order.id,
                  note: 'Earned on order ' + order.id,
                  sourceOrderId: order.id,
                },
              });
            }
          }
        }
        return {
          processed: true,
          settled: true,
          duplicate: false,
          orderId: order.id,
          receiptNumber: receipt.number,
          receiptPayload: receipt.payload,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );

    if (!result.duplicate) {
      const orderId = (result as { orderId: string }).orderId;
      const settledOrder = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          branchId: true,
          sessionId: true,
          channel: true,
          grandTotal: true,
          items: { select: { productId: true } },
        },
      });
      if (settledOrder) {
        this.realtime.orderCompleted(settledOrder.branchId, {
          orderId,
          channel: settledOrder.channel,
          grandTotal: settledOrder.grandTotal.toString(),
          receiptNumber: (result as { receiptNumber?: string }).receiptNumber,
        });
        for (const item of settledOrder.items) {
          this.realtime.inventoryChanged(settledOrder.branchId, item.productId);
        }
        if (settledOrder.sessionId) {
          this.realtime.paymentUpdated(settledOrder.sessionId, {
            paymentId: orderId,
            status: 'SUCCEEDED',
          });
        }
      }
    }
    void providerKind;
    return result;
  }

  /**
   * FEFO (first-expiry-first-out) batch consumption. Batches without expiry
   * are consumed last. Movements carry the batchId for auditability.
   */
  private async allocateBatchesFefo(
    tx: Tx,
    branchId: string,
    productId: string,
    quantity: Prisma.Decimal,
    orderId: string,
  ): Promise<Prisma.Decimal> {
    const batches = await tx.$queryRaw<
      Array<{ id: string; quantity: Prisma.Decimal; expiryDate: Date | null }>
    >`
      SELECT id, quantity, "expiryDate" FROM "InventoryBatch"
      WHERE "branchId" = ${branchId}::uuid AND "productId" = ${productId}::uuid AND quantity > 0
      ORDER BY "expiryDate" ASC NULLS LAST, id ASC
      FOR UPDATE`;
    let remaining = quantity;
    for (const batch of batches) {
      if (remaining.isZero()) break;
      if (batch.quantity.lessThanOrEqualTo(remaining)) {
        remaining = remaining.minus(batch.quantity);
        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: { quantity: 0 },
        });
        await tx.stockMovement.create({
          data: {
            branchId,
            productId,
            batchId: batch.id,
            type: 'SALE',
            quantity: batch.quantity.negated(),
            reason: `Order ${orderId} (batch consumed)`,
            refType: 'order',
            refId: orderId,
          },
        });
      } else {
        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: { quantity: batch.quantity.minus(remaining) },
        });
        await tx.stockMovement.create({
          data: {
            branchId,
            productId,
            batchId: batch.id,
            type: 'SALE',
            quantity: remaining.negated(),
            reason: `Order ${orderId} (partial batch)`,
            refType: 'order',
            refId: orderId,
          },
        });
        remaining = new Prisma.Decimal(0);
      }
    }
    // Quantity beyond tracked batches is non-batch-tracked stock; the caller
    // records it as a plain SALE movement.
    return quantity.minus(remaining);
  }

  private async createReceipt(
    tx: Tx,
    order: Prisma.OrderGetPayload<{ include: { items: { include: { taxLines: true } } } }>,
    payment: { provider: string; amount: Prisma.Decimal; currency: string; method: string | null },
  ): Promise<{ number: string; payload: ConfirmReceiptPayload }> {
    const [branch, settings, existingCount] = await Promise.all([
      tx.branch.findUniqueOrThrow({ where: { id: order.branchId } }),
      tx.storeSettings.findUnique({ where: { branchId: order.branchId } }),
      tx.receipt.count(),
    ]);
    // Sequential invoice number; unique constraint + retry loop guards races.
    const prefix = settings?.invoicePrefix ?? 'INV-';
    let number = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      number = `${prefix}${new Date().getFullYear()}-${String(existingCount + 1 + attempt).padStart(6, '0')}`;
      const clash = await tx.receipt.findUnique({ where: { number }, select: { id: true } });
      if (!clash) break;
    }

    const payload: ConfirmReceiptPayload = {
      invoiceNumber: number,
      issuedAt: new Date().toISOString(),
      store: {
        name: branch.name,
        code: branch.code,
        address: branch.address,
        city: branch.city,
        state: branch.state,
        gstin: branch.gstin,
        phone: branch.phone,
      },
      order: {
        id: order.id,
        channel: order.channel,
        placedAt: order.placedAt.toISOString(),
        currency: order.currency,
      },
      lines: order.items.map((item) => ({
        name: item.name,
        sku: item.sku,
        quantity: item.quantity.toString(),
        unit: item.unit,
        unitPrice: item.unitPrice.toString(),
        lineSubtotal: item.lineSubtotal.toString(),
        lineDiscountTotal: item.lineDiscountTotal.toString(),
        taxableValue: item.taxableValue.toString(),
        lineTaxTotal: item.lineTaxTotal.toString(),
        lineTotal: item.lineTotal.toString(),
        taxSplit: item.taxSplit,
        taxLines: item.taxLines.map((t) => ({
          name: t.name,
          rate: t.rate.toString(),
          basisAmount: t.basisAmount.toString(),
          amount: t.amount.toString(),
        })),
      })),
      totals: {
        subtotal: order.subtotal.toString(),
        itemDiscountTotal: order.itemDiscountTotal.toString(),
        couponDiscountTotal: order.couponDiscountTotal.toString(),
        loyaltyDiscountTotal: order.loyaltyDiscountTotal.toString(),
        taxTotal: order.taxTotal.toString(),
        roundingAdjustment: order.roundingAdjustment.toString(),
        grandTotal: order.grandTotal.toString(),
      },
      payment: {
        provider: payment.provider,
        method: payment.method,
        amount: payment.amount.toString(),
        currency: payment.currency,
      },
    };

    const receipt = await tx.receipt.create({
      data: { orderId: order.id, number, payload: payload as unknown as Prisma.InputJsonValue },
      select: { number: true, payload: true },
    });
    return { number: receipt.number, payload: payload };
  }

  private paiseMinor(value: Prisma.Decimal): number {
    return Number(value.times(100).toFixed(0));
  }

  private providerFor(kind: 'MOCK' | 'RAZORPAY'): PaymentProvider {
    const provider = this.providers[kind];
    if (!provider) throw new ServiceUnavailableException({ code: 'PROVIDER_NOT_CONFIGURED' });
    return provider;
  }
}
