import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface BranchScope {
  branchId: string | null;
}

/**
 * Dashboard metrics (Phase 5) — every number is derived from the database at
 * request time (spec §10: no decorative hardcoded charts). Branch-scoped via
 * the caller's home branch.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  private completedWhere(scope: BranchScope, since?: Date): Prisma.OrderWhereInput {
    return {
      status: { in: ['COMPLETED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'] },
      ...(scope.branchId ? { branchId: scope.branchId } : {}),
      ...(since ? { placedAt: { gte: since } } : {}),
    };
  }

  /** Today's gross sales, order count, average basket, payment mix. */
  async summary(scope: BranchScope): Promise<unknown> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const orders = await this.prisma.order.findMany({
      where: this.completedWhere(scope, startOfDay),
      select: { grandTotal: true, payments: { select: { provider: true, method: true } } },
    });
    const gross = orders.reduce((sum, o) => sum.plus(o.grandTotal), new Prisma.Decimal(0));
    const byMethod = new Map<string, { count: number; total: Prisma.Decimal }>();
    for (const order of orders) {
      const payment = order.payments[0];
      const key = payment?.provider ?? 'UNKNOWN';
      const entry = byMethod.get(key) ?? { count: 0, total: new Prisma.Decimal(0) };
      entry.count++;
      entry.total = entry.total.plus(order.grandTotal);
      byMethod.set(key, entry);
    }
    return {
      orders: orders.length,
      grossSales: gross.toString(),
      averageBasket: orders.length > 0 ? gross.dividedBy(orders.length).toFixed(2) : '0.00',
      paymentMix: [...byMethod.entries()].map(([provider, v]) => ({
        provider,
        orders: v.count,
        total: v.total.toString(),
      })),
    };
  }

  /** Sales by hour for the last 24 hours (completed orders only). */
  async salesByHour(scope: BranchScope): Promise<unknown> {
    const since = new Date(Date.now() - 24 * 3600_000);
    const orders = await this.prisma.order.findMany({
      where: this.completedWhere(scope, since),
      select: { grandTotal: true, placedAt: true },
    });
    const buckets = new Map<number, { orders: number; total: Prisma.Decimal }>();
    for (let h = 0; h < 24; h++) {
      const hour = new Date(since.getTime() + h * 3600_000).getHours();
      buckets.set(hour, { orders: 0, total: new Prisma.Decimal(0) });
    }
    for (const order of orders) {
      const hour = order.placedAt.getHours();
      const entry = buckets.get(hour) ?? { orders: 0, total: new Prisma.Decimal(0) };
      entry.orders++;
      entry.total = entry.total.plus(order.grandTotal);
      buckets.set(hour, entry);
    }
    return [...buckets.entries()].map(([hour, v]) => ({
      hour,
      orders: v.orders,
      total: v.total.toString(),
    }));
  }

  /** Top products by units sold (completed orders). */
  async topProducts(scope: BranchScope): Promise<unknown> {
    const top = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: this.completedWhere(scope),
      },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 8,
    });
    const products = await this.prisma.product.findMany({
      where: { id: { in: top.map((t) => t.productId) } },
      select: { id: true, name: true, sku: true },
    });
    const nameById = new Map(products.map((p) => [p.id, p]));
    return top.map((t) => ({
      productId: t.productId,
      name: nameById.get(t.productId)?.name ?? '—',
      sku: nameById.get(t.productId)?.sku ?? '',
      unitsSold: t._sum.quantity?.toFixed(3) ?? '0.000',
      revenue: t._sum.lineTotal?.toString() ?? '0.00',
    }));
  }

  /** Latest orders for the live feed (Phase 4 scope, kept for /dashboard). */
  async recentOrders(scope: BranchScope): Promise<unknown> {
    const orders = await this.prisma.order.findMany({
      where: scope.branchId ? { branchId: scope.branchId } : {},
      select: {
        id: true,
        channel: true,
        status: true,
        grandTotal: true,
        currency: true,
        placedAt: true,
        completedAt: true,
        receipt: { select: { number: true } },
        payments: { select: { provider: true, status: true } },
      },
      orderBy: { placedAt: 'desc' },
      take: 12,
    });
    return orders.map((o) => ({
      orderId: o.id,
      channel: o.channel,
      status: o.status,
      grandTotal: o.grandTotal.toString(),
      currency: o.currency,
      placedAt: o.placedAt.toISOString(),
      completedAt: o.completedAt?.toISOString() ?? null,
      receiptNumber: o.receipt?.number ?? null,
      payment: o.payments[0]?.provider ?? null,
      paymentStatus: o.payments[0]?.status ?? null,
    }));
  }
}
