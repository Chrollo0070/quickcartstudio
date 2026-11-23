import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { RealtimeService } from '../realtime/realtime.service';
import type { CartQuote, PricingContext, PricingLineInput } from '../pricing/pricing.types';
import { generateSessionToken } from './session-token.util';
import type {
  AttachCustomerInput,
  ConfirmInput,
  QuoteInput,
  ScanInput,
  SearchQueryInput,
  UpdateItemInput,
} from './dto';

const SESSION_TTL_MS = 30 * 60_000; // self-checkout session lifetime (sliding)
const RESERVATION_TTL_MS = 10 * 60_000; // ADR-004 default reservation hold

const SESSION_INCLUDE = {
  items: {
    include: {
      product: {
        include: {
          barcodes: { orderBy: [{ isPrimary: 'desc' as const }, { createdAt: 'asc' as const }] },
        },
      },
    },
    orderBy: { addedAt: 'asc' as const },
  },
} satisfies Prisma.CheckoutSessionInclude;

type SessionWithItems = Prisma.CheckoutSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

const errors = {
  sessionNotFound: () =>
    new NotFoundException({ message: 'Checkout session not found', code: 'SESSION_NOT_FOUND' }),
  sessionExpired: () =>
    new ConflictException({ message: 'Checkout session expired', code: 'SESSION_EXPIRED' }),
  sessionClosed: (status: string) =>
    new ConflictException({ message: `Checkout session is ${status}`, code: 'SESSION_CLOSED' }),
  productNotFound: () =>
    new NotFoundException({ message: 'Barcode not found', code: 'PRODUCT_NOT_FOUND' }),
  productUnavailable: () =>
    new ConflictException({
      message: 'Product is not available at this branch',
      code: 'PRODUCT_UNAVAILABLE',
    }),
  outOfStock: () =>
    new ConflictException({ message: 'Not enough stock available', code: 'OUT_OF_STOCK' }),
  itemNotFound: () =>
    new NotFoundException({ message: 'Cart item not found', code: 'ITEM_NOT_FOUND' }),
  couponExhausted: () =>
    new ConflictException({ message: 'Coupon has no redemptions left', code: 'COUPON_EXHAUSTED' }),
  customerNotFound: () =>
    new NotFoundException({ message: 'No customer with that phone', code: 'CUSTOMER_NOT_FOUND' }),
  loyaltyNoCustomer: () =>
    new ConflictException({
      message: 'Attach a customer (phone) before redeeming loyalty points',
      code: 'LOYALTY_NO_CUSTOMER',
    }),
  loyaltyInsufficient: () =>
    new ConflictException({
      message: 'Not enough loyalty points on the account',
      code: 'LOYALTY_INSUFFICIENT_POINTS',
    }),
  loyaltyBelowMin: (min: number) =>
    new ConflictException({
      message: 'Minimum redemption is ' + min + ' points',
      code: 'LOYALTY_BELOW_MIN',
    }),
  loyaltyExceedsCap: () =>
    new ConflictException({
      message: 'Redemption exceeds the maximum share of the cart',
      code: 'LOYALTY_EXCEEDS_MAX',
    }),
  emptyCart: () => new ConflictException({ message: 'Cart is empty', code: 'EMPTY_CART' }),
  staleCart: (freshQuote: CartQuote) =>
    new ConflictException({
      message: 'Cart changed — review the fresh quote and confirm again',
      code: 'CART_STALE',
      freshQuote,
    }),
};

/**
 * Customer self-checkout domain. Prices, coupons and stock are resolved
 * server-side on every read (spec §5/§7); the browser only displays.
 *
 * Reservation strategy (ADR-004): scanning conditionally increments
 * `InventoryBalance.reserved` inside the same transaction as the cart
 * mutation — the conditional UPDATE guards against oversell under
 * concurrent checkouts. Reservations convert to a sale at payment
 * settlement (Phase 3); until then they keep holding stock.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly realtime: RealtimeService,
  ) {}

  async createSession(
    branchId: string,
  ): Promise<{ sessionId: string; sessionToken: string; expiresAt: string }> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, isActive: true },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException({
        message: 'Branch not found or inactive',
        code: 'BRANCH_NOT_FOUND',
      });
    }
    const token = generateSessionToken();
    const session = await this.prisma.checkoutSession.create({
      data: {
        branchId,
        channel: 'SELF_CHECKOUT',
        sessionTokenHash: token.tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
      select: { id: true, expiresAt: true },
    });
    return {
      sessionId: session.id,
      sessionToken: token.raw,
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  async getSession(sessionId: string): Promise<unknown> {
    return this.prisma
      .$transaction(async (tx) => {
        await this.getOpenSession(tx, sessionId);
      })
      .then(() => this.sessionView(sessionId));
  }

  /** POS sessions: staff-owned, no possession token, availability-checked at settle. */
  async createOperatorSession(
    branchId: string,
    operatorUserId: string,
  ): Promise<{ sessionId: string; branchId: string }> {
    const session = await this.prisma.checkoutSession.create({
      data: {
        branchId,
        channel: 'POS',
        operatorUserId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
      select: { id: true, branchId: true },
    });
    return { sessionId: session.id, branchId: session.branchId };
  }

  /**
   * Operator scan: availability check only (POS does not reserve — the settle
   * transaction's conditional decrement is the oversell guard, ADR-004).
   */
  async operatorScan(sessionId: string, input: ScanInput): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.getOpenSession(tx, sessionId);
      const found = await tx.productBarcode.findUnique({
        where: { barcode: input.barcode },
        include: {
          product: {
            include: {
              branchProducts: { where: { branchId: session.branchId } },
              balances: { where: { branchId: session.branchId } },
            },
          },
        },
      });
      if (!found) throw errors.productNotFound();
      const branchProduct = found.product.branchProducts[0];
      if (!branchProduct?.isAvailable) throw errors.productUnavailable();
      const balance = found.product.balances[0];
      const available = balance ? balance.onHand.minus(balance.reserved) : new Prisma.Decimal(0);
      const alreadyInCart =
        (
          await tx.checkoutSessionItem.findUnique({
            where: { sessionId_productId: { sessionId, productId: found.productId } },
            select: { quantity: true },
          })
        )?.quantity ?? new Prisma.Decimal(0);
      if (available.minus(alreadyInCart).lessThan(1)) throw errors.outOfStock();

      const item = await tx.checkoutSessionItem.upsert({
        where: { sessionId_productId: { sessionId, productId: found.productId } },
        update: { quantity: { increment: 1 } },
        create: {
          sessionId,
          productId: found.productId,
          quantity: 1,
          priceAtScan: branchProduct.priceOverride ?? found.product.sellingPrice,
        },
      });
      await tx.checkoutSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
      this.realtime.sessionUpdated(sessionId);
      this.realtime.inventoryChanged(session.branchId, found.productId);
      return {
        sessionId,
        itemId: item.id,
        productId: found.productId,
        name: found.product.name,
        sku: found.product.sku,
        unit: found.product.unit,
        isWeighed: found.product.isWeighed,
        quantity: item.quantity.toFixed(3),
        unitPrice: (branchProduct.priceOverride ?? found.product.sellingPrice).toFixed(2),
        availableStock: available.toFixed(3),
      };
    });
  }

  /** POS suspend/resume (channel-guarded); resume revalidates prices on next quote. */
  async setSuspended(sessionId: string, suspended: boolean): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const session = await tx.checkoutSession.findUnique({
        where: { id: sessionId },
        select: { status: true, channel: true },
      });
      if (!session) throw errors.sessionNotFound();
      if (session.channel !== 'POS') {
        throw new ConflictException({
          message: 'Only POS sessions can be suspended',
          code: 'NOT_A_POS_SESSION',
        });
      }
      if (suspended && session.status !== 'OPEN') {
        throw errors.sessionClosed(session.status);
      }
      if (!suspended && session.status !== 'SUSPENDED') {
        throw errors.sessionClosed(session.status);
      }
      await tx.checkoutSession.update({
        where: { id: sessionId },
        data: {
          status: suspended ? 'SUSPENDED' : 'OPEN',
          expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        },
      });
    });
  }

  async search(sessionId: string, query: SearchQueryInput): Promise<unknown> {
    const session = await this.loadSession(sessionId);
    const term = query.q.trim();
    const rows = await this.prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { sku: { contains: term, mode: 'insensitive' } },
          { barcodes: { some: { barcode: term } } },
        ],
        branchProducts: { some: { branchId: session.branchId, isAvailable: true } },
      },
      include: {
        barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }], take: 1 },
        branchProducts: { where: { branchId: session.branchId } },
        balances: { where: { branchId: session.branchId } },
      },
      take: 8,
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => {
      const branchProduct = row.branchProducts[0];
      const balance = row.balances[0];
      const available = balance ? balance.onHand.minus(balance.reserved) : new Prisma.Decimal(0);
      return {
        productId: row.id,
        name: row.name,
        sku: row.sku,
        barcode: row.barcodes[0]?.barcode ?? '',
        unit: row.unit,
        isWeighed: row.isWeighed,
        unitPrice: (branchProduct?.priceOverride ?? row.sellingPrice).toFixed(2),
        availableStock: available.toFixed(3),
      };
    });
  }

  /** Scan → add/increment item + reserve one unit, atomically. */
  async scan(sessionId: string, input: ScanInput): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      const session = await this.getOpenSession(tx, sessionId);
      const found = await tx.productBarcode.findUnique({
        where: { barcode: input.barcode },
        include: {
          product: {
            include: {
              branchProducts: { where: { branchId: session.branchId } },
            },
          },
        },
      });
      if (!found) throw errors.productNotFound();
      const branchProduct = found.product.branchProducts[0];
      if (!branchProduct?.isAvailable) throw errors.productUnavailable();

      // Scan always adds one unit ( weighed products start at 1.000 kg and the
      // customer/staff adjusts the exact weight via PATCH).
      const reserved = await this.reserveStock(
        tx,
        session.branchId,
        found.productId,
        new Prisma.Decimal('1.000'),
      );
      if (!reserved) throw errors.outOfStock();

      const reservation = await tx.stockReservation.upsert({
        where: { sessionId_productId: { sessionId, productId: found.productId } },
        update: {
          quantity: { increment: 1 },
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
        create: {
          branchId: session.branchId,
          productId: found.productId,
          sessionId,
          quantity: 1,
          expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
        },
      });

      // Ledger records the hold lifecycle; onHand is untouched by RESERVATION.
      await tx.stockMovement.create({
        data: {
          branchId: session.branchId,
          productId: found.productId,
          type: 'RESERVATION',
          quantity: 1,
          reason: 'Self-checkout scan hold',
          refType: 'checkout_session',
          refId: sessionId,
        },
      });

      const item = await tx.checkoutSessionItem.upsert({
        where: { sessionId_productId: { sessionId, productId: found.productId } },
        update: { quantity: { increment: 1 } },
        create: {
          sessionId,
          productId: found.productId,
          quantity: 1,
          priceAtScan: branchProduct.priceOverride ?? found.product.sellingPrice,
        },
      });

      // Sliding session TTL keeps an actively scanning customer alive.
      await tx.checkoutSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });

      this.realtime.sessionUpdated(sessionId);
      this.realtime.inventoryChanged(session.branchId, found.productId);

      return {
        sessionId,
        itemId: item.id,
        productId: found.productId,
        name: found.product.name,
        sku: found.product.sku,
        unit: found.product.unit,
        isWeighed: found.product.isWeighed,
        quantity: item.quantity.toFixed(3),
        unitPrice: (branchProduct.priceOverride ?? found.product.sellingPrice).toFixed(2),
        reservationExpiresAt: reservation.expiresAt.toISOString(),
      };
    });
  }

  async updateItem(sessionId: string, itemId: string, input: UpdateItemInput): Promise<unknown> {
    await this.prisma.$transaction(async (tx) => {
      const session = await this.getOpenSession(tx, sessionId);
      const item = await tx.checkoutSessionItem.findFirst({
        where: { id: itemId, sessionId },
      });
      if (!item) throw errors.itemNotFound();

      const newQty = new Prisma.Decimal(input.quantity);
      const delta = newQty.minus(item.quantity);
      if (delta.isZero()) return;

      if (delta.greaterThan(0)) {
        const reserved = await this.reserveStock(tx, session.branchId, item.productId, delta);
        if (!reserved) throw errors.outOfStock();
        await tx.stockReservation.updateMany({
          where: { sessionId, productId: item.productId, status: 'ACTIVE' },
          data: { quantity: { increment: delta } },
        });
        await tx.stockMovement.create({
          data: {
            branchId: session.branchId,
            productId: item.productId,
            type: 'RESERVATION',
            quantity: delta,
            reason: 'Quantity increased',
            refType: 'checkout_session',
            refId: sessionId,
          },
        });
      } else {
        const releaseQty = delta.abs();
        await this.releaseStock(tx, session.branchId, item.productId, releaseQty);
        await tx.stockReservation.updateMany({
          where: { sessionId, productId: item.productId, status: 'ACTIVE' },
          data: { quantity: { decrement: releaseQty } },
        });
        await tx.stockMovement.create({
          data: {
            branchId: session.branchId,
            productId: item.productId,
            type: 'RESERVATION_RELEASE',
            quantity: releaseQty.negated(),
            reason: 'Quantity decreased',
            refType: 'checkout_session',
            refId: sessionId,
          },
        });
      }

      await tx.checkoutSessionItem.update({ where: { id: itemId }, data: { quantity: newQty } });
      await tx.checkoutSession.update({
        where: { id: sessionId },
        data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
    });
    return this.sessionView(sessionId);
  }

  async removeItem(sessionId: string, itemId: string): Promise<unknown> {
    await this.prisma.$transaction(async (tx) => {
      const session = await this.getOpenSession(tx, sessionId);
      const item = await tx.checkoutSessionItem.findFirst({ where: { id: itemId, sessionId } });
      if (!item) throw errors.itemNotFound();
      await this.releaseStock(tx, session.branchId, item.productId, item.quantity);
      await tx.stockReservation.updateMany({
        where: { sessionId, productId: item.productId, status: 'ACTIVE' },
        data: { quantity: { decrement: item.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          branchId: session.branchId,
          productId: item.productId,
          type: 'RESERVATION_RELEASE',
          quantity: item.quantity.negated(),
          reason: 'Item removed from cart',
          refType: 'checkout_session',
          refId: sessionId,
        },
      });
      await tx.checkoutSessionItem.delete({ where: { id: itemId } });
    });
    return this.sessionView(sessionId);
  }

  /** Server-authoritative quote; also persisted as the session's snapshot. */
  async quote(sessionId: string, input: QuoteInput): Promise<{ quote: CartQuote }> {
    const session = await this.loadSession(sessionId);
    await this.prisma.$transaction(async (tx) => {
      await this.getOpenSession(tx, sessionId);
    });
    const sessionRow = await this.prisma.checkoutSession.findUniqueOrThrow({
      where: { id: session.id },
      select: { id: true, branchId: true, customerId: true, loyaltyPointsRequested: true },
    });
    const requestedPoints = input.loyaltyPoints ?? sessionRow.loyaltyPointsRequested ?? 0;
    const loyalty = await this.validatedLoyalty(this.prisma, sessionRow, requestedPoints);
    if (input.loyaltyPoints !== undefined) {
      await this.prisma.checkoutSession.update({
        where: { id: session.id },
        data: { loyaltyPointsRequested: loyalty ? loyalty.points : 0 },
      });
    }
    const result = await this.buildQuote(session.id, input.couponCode ?? null, loyalty);
    await this.prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { quoteSnapshot: result.quote as unknown as Prisma.InputJsonValue },
    });
    return { quote: result.quote };
  }

  /**
   * Confirm the cart into a PENDING_PAYMENT order. Revalidates everything
   * (prices, coupon, stock) fresh from the database inside a row-locked
   * transaction; a stale `expectedQuoteHash` is rejected with CART_STALE.
   * Payment settlement (and the stock decrement) happens in Phase 3.
   */
  async confirm(sessionId: string, input: ConfirmInput): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent confirms on this session row.
      await tx.$queryRaw`SELECT id FROM "CheckoutSession" WHERE id = ${sessionId}::uuid FOR UPDATE`;

      // Idempotent retry BEFORE the status check: a retried confirm on an
      // already-converted session must return the original order, not an error.
      const existing = await tx.order.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, status: true },
      });
      if (existing) {
        return { orderId: existing.id, status: existing.status, sessionId, retry: true };
      }

      const session = await this.getOpenSession(tx, sessionId);
      const sessionRow = await tx.checkoutSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: {
          branchId: true,
          channel: true,
          couponId: true,
          customerId: true,
          loyaltyPointsRequested: true,
        },
      });

      let couponCode: string | null = null;
      if (sessionRow.couponId) {
        const coupon = await tx.coupon.findUnique({
          where: { id: sessionRow.couponId },
          select: { code: true },
        });
        couponCode = coupon?.code ?? null;
      }
      const loyaltyContext = await this.validatedLoyalty(
        tx,
        sessionRow,
        sessionRow.loyaltyPointsRequested ?? 0,
      );
      const { quote: freshQuote, couponId } = await this.buildQuoteWithCoupon(
        tx,
        { id: sessionId, branchId: sessionRow.branchId },
        couponCode,
        loyaltyContext,
      );

      if (freshQuote.lines.length === 0) throw errors.emptyCart();
      if (input.expectedQuoteHash && input.expectedQuoteHash !== freshQuote.hash) {
        throw errors.staleCart(freshQuote);
      }

      // Enforce redemption limits (the quote itself never consumes usage).
      if (couponId && freshQuote.couponApplied) {
        const coupon = await tx.coupon.findUniqueOrThrow({
          where: { id: couponId },
          select: { isActive: true, expiresAt: true, maxRedemptions: true },
        });
        if (!coupon.isActive || (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now())) {
          throw errors.staleCart(freshQuote);
        }
        if (coupon.maxRedemptions !== null) {
          const consumed = await tx.coupon.updateMany({
            where: { id: couponId, usageCount: { lt: coupon.maxRedemptions } },
            data: { usageCount: { increment: 1 } },
          });
          if (consumed.count !== 1) throw errors.couponExhausted();
        } else {
          await tx.coupon.update({
            where: { id: couponId },
            data: { usageCount: { increment: 1 } },
          });
        }
      }

      const order = await tx.order.create({
        data: {
          branchId: session.branchId,
          channel: session.channel,
          customerId: sessionRow.customerId,
          sessionId,
          status: 'PENDING_PAYMENT',
          currency: freshQuote.currency,
          subtotal: freshQuote.subtotal,
          itemDiscountTotal: freshQuote.itemDiscountTotal,
          couponDiscountTotal: freshQuote.couponDiscountTotal,
          loyaltyDiscountTotal: '0',
          taxTotal: freshQuote.taxTotal,
          roundingAdjustment: freshQuote.roundingAdjustment,
          grandTotal: freshQuote.grandTotal,
          idempotencyKey: input.idempotencyKey,
          items: {
            create: freshQuote.lines.map((line) => ({
              productId: line.productId,
              name: line.name,
              sku: line.sku,
              unit: line.unit as 'PIECE' | 'PACK' | 'KG' | 'G' | 'L' | 'ML',
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              lineSubtotal: line.lineSubtotal,
              lineDiscountTotal: line.lineDiscountTotal,
              taxableValue: line.taxableValue,
              lineTaxTotal: line.lineTaxTotal,
              lineTotal: line.lineTotal,
              taxSplit: line.taxSplit,
              taxInclusive: line.taxInclusive,
              taxLines: {
                create: line.taxLines.map((t) => ({
                  name: t.name,
                  rate: t.rate,
                  basisAmount: t.basisAmount,
                  amount: t.amount,
                })),
              },
            })),
          },
        },
        select: { id: true, status: true },
      });

      if (couponId && freshQuote.couponApplied) {
        await tx.couponRedemption.create({ data: { couponId, orderId: order.id } });
      }

      // Loyalty redemption: transactional ledger + balance update (spec §12 —
      // the balance is never an unexplained editable number).
      if (loyaltyContext && freshQuote.loyaltyApplied && sessionRow.customerId) {
        const account = await tx.loyaltyAccount.findUniqueOrThrow({
          where: { customerId: sessionRow.customerId },
        });
        const balanceAfter = account.points - loyaltyContext.points;
        await tx.loyaltyAccount.update({
          where: { id: account.id },
          data: { points: { decrement: loyaltyContext.points } },
        });
        await tx.loyaltyLedgerEntry.create({
          data: {
            accountId: account.id,
            type: 'REDEEM',
            pointsDelta: -loyaltyContext.points,
            balanceAfter,
            idempotencyKey: 'redeem:order:' + order.id,
            note: 'Redeemed on order ' + order.id,
            sourceOrderId: order.id,
          },
        });
      }

      await tx.checkoutSession.update({
        where: { id: sessionId },
        data: {
          status: 'CONVERTED',
          quoteSnapshot: freshQuote as unknown as Prisma.InputJsonValue,
        },
      });

      return { orderId: order.id, status: order.status, quote: freshQuote, sessionId };
    });
  }

  async cancel(sessionId: string): Promise<unknown> {
    await this.prisma.$transaction(async (tx) => {
      const session = await this.getOpenSession(tx, sessionId);
      await this.releaseAllReservations(
        tx,
        sessionId,
        session.branchId,
        'Session cancelled by customer',
      );
      await tx.checkoutSession.update({ where: { id: sessionId }, data: { status: 'CANCELLED' } });
    });
    return { sessionId, status: 'CANCELLED' };
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private async loadSession(sessionId: string): Promise<{ id: string; branchId: string }> {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      select: { id: true, branchId: true },
    });
    if (!session) throw errors.sessionNotFound();
    return session;
  }

  private async getOpenSession(
    tx: Tx,
    sessionId: string,
  ): Promise<{
    id: string;
    branchId: string;
    channel: 'SELF_CHECKOUT' | 'POS';
    status: string;
    expiresAt: Date;
  }> {
    const session = await tx.checkoutSession.findUnique({
      where: { id: sessionId },
      select: { id: true, branchId: true, channel: true, status: true, expiresAt: true },
    });
    if (!session) throw errors.sessionNotFound();
    if (session.status === 'OPEN' && session.expiresAt.getTime() <= Date.now()) {
      await this.releaseAllReservations(tx, sessionId, session.branchId, 'Session expired');
      await tx.checkoutSession.update({ where: { id: sessionId }, data: { status: 'EXPIRED' } });
      throw errors.sessionExpired();
    }
    if (session.status !== 'OPEN') throw errors.sessionClosed(session.status);
    return session;
  }

  /** Conditional reservation increment — returns false when stock ran out. */
  private async reserveStock(
    tx: Tx,
    branchId: string,
    productId: string,
    qty: Prisma.Decimal,
  ): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE "InventoryBalance"
      SET "reserved" = "reserved" + ${qty.toFixed(3)}::numeric, "updatedAt" = now()
      WHERE "branchId" = ${branchId}::uuid AND "productId" = ${productId}::uuid
        AND "onHand" - "reserved" >= ${qty.toFixed(3)}::numeric`;
    return updated === 1;
  }

  private async releaseStock(
    tx: Tx,
    branchId: string,
    productId: string,
    qty: Prisma.Decimal,
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE "InventoryBalance"
      SET "reserved" = GREATEST(0, "reserved" - ${qty.toFixed(3)}::numeric), "updatedAt" = now()
      WHERE "branchId" = ${branchId}::uuid AND "productId" = ${productId}::uuid`;
  }

  private async releaseAllReservations(
    tx: Tx,
    sessionId: string,
    branchId: string,
    reason: string,
  ): Promise<void> {
    const active = await tx.stockReservation.findMany({
      where: { sessionId, status: 'ACTIVE' },
      select: { id: true, productId: true, quantity: true },
    });
    for (const reservation of active) {
      await this.releaseStock(tx, branchId, reservation.productId, reservation.quantity);
      await tx.stockMovement.create({
        data: {
          branchId,
          productId: reservation.productId,
          type: 'RESERVATION_RELEASE',
          quantity: reservation.quantity.negated(),
          reason,
          refType: 'checkout_session',
          refId: sessionId,
        },
      });
      await tx.stockReservation.update({
        where: { id: reservation.id },
        data: { status: 'RELEASED' },
      });
    }
  }

  /** Attach a walk-in customer by phone (loyalty demo path). */
  async attachCustomer(sessionId: string, input: AttachCustomerInput): Promise<unknown> {
    const customer = await this.prisma.customer.findUnique({ where: { phone: input.phone } });
    if (!customer) throw errors.customerNotFound();
    await this.prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { customerId: customer.id },
    });
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId: customer.id },
      select: { points: true },
    });
    return { customerId: customer.id, name: customer.name, loyaltyPoints: account?.points ?? 0 };
  }

  /** Validate loyalty rules against the live account + store settings. */
  private async validatedLoyalty(
    client: Db,
    sessionRow: { customerId: string | null; branchId: string },
    requestedPoints: number,
  ): Promise<{ points: number; redeemRateMinorPerPoint: bigint } | null> {
    if (requestedPoints <= 0) return null;
    if (!sessionRow.customerId) throw errors.loyaltyNoCustomer();
    const account = await client.loyaltyAccount.findUnique({
      where: { customerId: sessionRow.customerId },
    });
    if (!account || account.points < requestedPoints) throw errors.loyaltyInsufficient();
    const settings = await client.storeSettings.findUnique({
      where: { branchId: sessionRow.branchId! },
    });
    const min = settings?.loyaltyMinRedeemPoints ?? 0;
    if (requestedPoints < min) throw errors.loyaltyBelowMin(min);
    return {
      points: requestedPoints,
      redeemRateMinorPerPoint: BigInt(settings!.loyaltyRedeemRate.times(100).toFixed(0)),
    };
  }

  /** Full authoritative price rebuild for the current cart (+ coupon attach). */
  private async buildQuote(
    sessionId: string,
    couponCode: string | null,
    loyalty?: { points: number; redeemRateMinorPerPoint: bigint } | null,
  ): Promise<{ quote: CartQuote; couponId: string | null }> {
    const session = await this.prisma.checkoutSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { id: true, branchId: true },
    });
    if (couponCode) {
      const coupon = await this.prisma.coupon.findUnique({
        where: { code: couponCode },
        select: { id: true },
      });
      if (coupon) {
        await this.prisma.checkoutSession.update({
          where: { id: sessionId },
          data: { couponId: coupon.id },
        });
      }
    }
    return this.buildQuoteWithCoupon(this.prisma, session, couponCode, loyalty);
  }

  private async buildQuoteWithCoupon(
    client: Db,
    session: { id: string; branchId: string },
    couponCode: string | null,
    loyalty?: { points: number; redeemRateMinorPerPoint: bigint } | null,
  ): Promise<{ quote: CartQuote; couponId: string | null }> {
    const [items, settings, branch, coupon] = await Promise.all([
      client.checkoutSessionItem.findMany({
        where: { sessionId: session.id },
        include: {
          product: {
            include: {
              taxCategory: true,
              branchProducts: { where: { branchId: session.branchId } },
            },
          },
        },
        orderBy: { addedAt: 'asc' },
      }),
      client.storeSettings.findUnique({ where: { branchId: session.branchId } }),
      client.branch.findUniqueOrThrow({ where: { id: session.branchId }, select: { state: true } }),
      couponCode
        ? client.coupon.findUnique({ where: { code: couponCode }, include: { promotion: true } })
        : Promise.resolve(null),
    ]);

    const now = Date.now();
    const couponUsable = Boolean(
      coupon?.isActive &&
      coupon.promotion.isActive &&
      (!coupon.expiresAt || coupon.expiresAt.getTime() > now) &&
      (!coupon.promotion.endsAt || coupon.promotion.endsAt.getTime() > now),
    );
    const couponInput = couponUsable
      ? {
          code: coupon!.code,
          kind: coupon!.promotion.kind,
          value: coupon!.promotion.value.toString(),
          maxDiscount: coupon!.promotion.maxDiscount?.toString() ?? null,
          minCartValue: coupon!.promotion.minCartValue?.toString() ?? null,
        }
      : null;

    const lines: PricingLineInput[] = items.map((item) => {
      const branchProduct = item.product.branchProducts[0];
      return {
        productId: item.productId,
        name: item.product.name,
        sku: item.product.sku,
        unit: item.product.unit,
        quantity: item.quantity.toFixed(3),
        unitPrice: (branchProduct?.priceOverride ?? item.product.sellingPrice).toFixed(2),
        taxRate: item.product.taxCategory.rate.toFixed(4),
        // Product override wins; otherwise the branch-wide default applies.
        taxInclusive: item.product.taxInclusive ?? settings?.taxMode === 'TAX_INCLUSIVE',
        linePromotion: null, // product-level promotions land with the POS phase
      };
    });

    const context: PricingContext = {
      currency: settings?.currency ?? 'INR',
      taxMode: settings?.taxMode ?? 'TAX_EXCLUSIVE',
      roundingMode: settings?.roundingMode ?? 'HALF_UP',
      // MVP: in-store sale → place of supply is the branch's state (intra-state).
      supplierState: branch.state ?? '',
      placeOfSupplyState: branch.state ?? '',
      coupon: couponInput,
      loyalty: loyalty ?? null,
    };

    return {
      quote: this.pricing.quote(lines, context),
      couponId: couponUsable ? coupon!.id : null,
    };
  }

  private async sessionView(sessionId: string): Promise<unknown> {
    const session = await this.prisma.checkoutSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: SESSION_INCLUDE,
    });
    return this.mapSession(session);
  }

  private async mapSession(session: SessionWithItems): Promise<unknown> {
    // Resolve current branch prices per item (the server is authoritative).
    const branchProducts = await this.prisma.branchProduct.findMany({
      where: {
        branchId: session.branchId,
        productId: { in: session.items.map((i) => i.productId) },
      },
    });
    const overrideByProduct = new Map(branchProducts.map((bp) => [bp.productId, bp.priceOverride]));
    return {
      id: session.id,
      branchId: session.branchId,
      channel: session.channel,
      status: session.status,
      expiresAt: session.expiresAt.toISOString(),
      items: session.items.map((item) => ({
        itemId: item.id,
        productId: item.productId,
        name: item.product.name,
        sku: item.product.sku,
        barcode: item.product.barcodes[0]?.barcode ?? '',
        unit: item.product.unit,
        isWeighed: item.product.isWeighed,
        quantity: item.quantity.toFixed(3),
        unitPrice: (overrideByProduct.get(item.productId) ?? item.product.sellingPrice).toFixed(2),
      })),
    };
  }
}
