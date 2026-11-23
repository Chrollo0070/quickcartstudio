import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/utils/paginate';
import { RealtimeService } from '../realtime/realtime.service';
import type { PaginatedEnvelope } from '../common/dto/pagination.dto';
import type {
  AdjustmentInput,
  GoodsReceiptInput,
  ListMovementsQuery,
  PurchaseOrderInput,
  SubmitCountInput,
} from './dto';

const NEAR_EXPIRY_DAYS = 7;

const errors = {
  productNotFound: () =>
    new NotFoundException({ message: 'Product not found', code: 'PRODUCT_NOT_FOUND' }),
  balanceNegative: () =>
    new ConflictException({
      message: 'Adjustment would make stock negative',
      code: 'STOCK_NEGATIVE',
    }),
  countNotFound: () =>
    new NotFoundException({ message: 'Stock count not found', code: 'COUNT_NOT_FOUND' }),
  countState: (status: string) =>
    new ConflictException({ message: `Count is ${status}`, code: 'COUNT_CLOSED' }),
  poNotFound: () =>
    new NotFoundException({ message: 'Purchase order not found', code: 'PO_NOT_FOUND' }),
  poState: (status: string) =>
    new ConflictException({ message: `Purchase order is ${status}`, code: 'PO_CLOSED' }),
};

export interface Actor {
  id: string;
  branchId: string | null;
  requestId?: string;
}

/**
 * Inventory operations (spec §11): receiving with batch/expiry, audited manual
 * adjustments, stock counts with discrepancy approval, movement history and
 * alerts. All stock mutations write the immutable ledger in the same
 * transaction; corrections never rewrite history.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  private resolveBranch(actor: Actor, requested?: string): string {
    return actor.branchId ?? requested ?? '';
  }

  /** Branch stock view with low-stock flags (available = onHand − reserved). */
  async listBalances(branchId: string): Promise<unknown> {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { branchId },
      include: {
        product: {
          select: { id: true, name: true, sku: true, unit: true, status: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return balances.map((b) => {
      const available = b.onHand.minus(b.reserved);
      return {
        productId: b.productId,
        name: b.product.name,
        sku: b.product.sku,
        unit: b.product.unit,
        onHand: b.onHand.toFixed(3),
        reserved: b.reserved.toFixed(3),
        available: available.toFixed(3),
        lowStockThreshold: b.lowStockThreshold.toFixed(3),
        isLowStock: available.lessThan(b.lowStockThreshold),
        updatedAt: b.updatedAt.toISOString(),
      };
    });
  }

  async listMovements(
    branchId: string,
    query: ListMovementsQuery,
  ): Promise<PaginatedEnvelope<unknown>> {
    const where = { branchId, productId: query.productId, type: query.type };
    const { skip, take } = paginate(query);
    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { product: { select: { name: true, sku: true } } },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return {
      data: rows.map((m) => ({
        id: m.id,
        type: m.type,
        quantity: m.quantity.toString(),
        reason: m.reason,
        refType: m.refType,
        refId: m.refId,
        product: { name: m.product.name, sku: m.product.sku },
        createdAt: m.createdAt.toISOString(),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /** Low-stock products + near-expiry batches (FEFO visibility, spec §11). */
  async alerts(branchId: string): Promise<unknown> {
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { branchId, product: { status: 'ACTIVE' } },
      include: { product: { select: { name: true, sku: true, unit: true } } },
    });
    const lowStock = balances
      .filter((b) => b.onHand.minus(b.reserved).lessThan(b.lowStockThreshold))
      .map((b) => ({
        productId: b.productId,
        name: b.product.name,
        sku: b.product.sku,
        available: b.onHand.minus(b.reserved).toFixed(3),
        threshold: b.lowStockThreshold.toFixed(3),
        // Simple reorder suggestion: bring available back to 2× the threshold.
        suggestedReorder: b.lowStockThreshold.times(2).minus(b.onHand.minus(b.reserved)).toFixed(3),
      }));

    const cutoff = new Date(Date.now() + NEAR_EXPIRY_DAYS * 86_400_000);
    const batches = await this.prisma.inventoryBatch.findMany({
      where: { branchId, quantity: { gt: 0 }, expiryDate: { not: null, lte: cutoff } },
      include: { product: { select: { name: true, sku: true } } },
      orderBy: { expiryDate: 'asc' },
      take: 50,
    });
    return {
      lowStock,
      nearExpiry: batches.map((b) => ({
        batchId: b.id,
        productId: b.productId,
        name: b.product.name,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate!.toISOString(),
        quantity: b.quantity.toFixed(3),
      })),
    };
  }

  /** Goods receipt: batches + balances + PURCHASE_RECEIPT ledger, one tx. */
  async receiveGoods(input: GoodsReceiptInput, actor: Actor): Promise<unknown> {
    const branchId = this.resolveBranch(actor);
    const number = `GR-${new Date().getFullYear()}-${String(
      (await this.prisma.goodsReceipt.count()) + 1,
    ).padStart(5, '0')}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const receipt = await tx.goodsReceipt.create({
        data: {
          number,
          purchaseOrderId: input.purchaseOrderId,
          branchId,
          supplierDeliveryRef: input.supplierDeliveryRef,
          status: 'DRAFT',
          receivedByUserId: actor.id,
        },
      });

      const lines = [];
      for (const line of input.lines) {
        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (!product) throw errors.productNotFound();
        const expiry = line.expiryDate ? new Date(line.expiryDate) : null;
        const batch = await tx.inventoryBatch.upsert({
          where: {
            branchId_productId_batchNumber: {
              branchId,
              productId: line.productId,
              batchNumber: line.batchNumber,
            },
          },
          update: { quantity: { increment: line.quantity }, expiryDate: expiry },
          create: {
            branchId,
            productId: line.productId,
            batchNumber: line.batchNumber,
            expiryDate: expiry,
            quantity: line.quantity,
          },
        });
        await tx.inventoryBalance.upsert({
          where: { branchId_productId: { branchId, productId: line.productId } },
          update: { onHand: { increment: line.quantity } },
          create: {
            branchId,
            productId: line.productId,
            onHand: line.quantity,
            reserved: 0,
            lowStockThreshold: 0,
          },
        });
        const grLine = await tx.goodsReceiptLine.create({
          data: {
            goodsReceiptId: receipt.id,
            productId: line.productId,
            batchNumber: line.batchNumber,
            expiryDate: expiry,
            quantity: line.quantity,
            unitCost: line.unitCost,
            batchId: batch.id,
          },
        });
        await tx.stockMovement.create({
          data: {
            branchId,
            productId: line.productId,
            batchId: batch.id,
            type: 'PURCHASE_RECEIPT',
            quantity: line.quantity,
            reason: `Goods receipt ${number}`,
            refType: 'goods_receipt',
            refId: receipt.id,
            actorUserId: actor.id,
          },
        });
        lines.push(grLine);
      }

      await tx.goodsReceipt.update({
        where: { id: receipt.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });

      if (input.purchaseOrderId) {
        for (const line of input.lines) {
          await tx.purchaseOrderLine.updateMany({
            where: { purchaseOrderId: input.purchaseOrderId, productId: line.productId },
            data: { receivedQty: { increment: line.quantity } },
          });
        }
        const po = await tx.purchaseOrder.findUniqueOrThrow({
          where: { id: input.purchaseOrderId },
          include: { lines: true },
        });
        const fully = po.lines.every((l) => l.receivedQty.greaterThanOrEqualTo(l.orderedQty));
        await tx.purchaseOrder.update({
          where: { id: po.id },
          data: { status: fully ? 'COMPLETED' : 'PARTIALLY_RECEIVED' },
        });
      }

      for (const line of input.lines) {
        this.realtime.inventoryChanged(branchId, line.productId);
      }
      return { receiptNumber: number, lines: lines.length };
    });

    await this.audit.log({
      actorUserId: actor.id,
      branchId,
      action: 'inventory.receipt.create',
      entityType: 'GoodsReceipt',
      entityId: null,
      metadata: { number: result.receiptNumber, lines: result.lines },
      requestId: actor.requestId,
    });
    return result;
  }

  /** Manual adjustment: mandatory reason + actor, ledger first-class. */
  async adjust(input: AdjustmentInput, actor: Actor): Promise<unknown> {
    const branchId = this.resolveBranch(actor);
    const delta = new Prisma.Decimal(input.quantityDelta);
    if (delta.isZero()) {
      throw new ConflictException({ message: 'Delta is zero', code: 'ZERO_DELTA' });
    }
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "InventoryBalance"
        SET "onHand" = "onHand" + ${delta}, "updatedAt" = now()
        WHERE "branchId" = ${branchId}::uuid AND "productId" = ${input.productId}::uuid
          AND "onHand" + ${delta} >= 0`;
      if (updated !== 1) throw errors.balanceNegative();
      const movement = await tx.stockMovement.create({
        data: {
          branchId,
          productId: input.productId,
          type: 'MANUAL_ADJUSTMENT',
          quantity: delta,
          reason: input.reason,
          refType: 'manual_adjustment',
          actorUserId: actor.id,
        },
      });
      return movement.id;
    });
    await this.audit.log({
      actorUserId: actor.id,
      branchId,
      action: 'inventory.adjustment.create',
      entityType: 'StockMovement',
      entityId: result,
      metadata: { productId: input.productId, delta: input.quantityDelta, reason: input.reason },
      requestId: actor.requestId,
    });
    this.realtime.inventoryChanged(branchId, input.productId);
    return { movementId: result, productId: input.productId, quantityDelta: input.quantityDelta };
  }

  /** Open a count: snapshot current system quantities for every product. */
  async createCount(actor: Actor): Promise<unknown> {
    const branchId = this.resolveBranch(actor);
    const balances = await this.prisma.inventoryBalance.findMany({
      where: { branchId },
      select: { productId: true, onHand: true },
    });
    const countNumber = `SC-${new Date().getFullYear()}-${String(
      (await this.prisma.stockCount.count()) + 1,
    ).padStart(5, '0')}`;
    const count = await this.prisma.stockCount.create({
      data: {
        countNumber,
        branchId,
        status: 'IN_PROGRESS',
        startedByUserId: actor.id,
        lines: {
          // Untouched lines implicitly "counted as system": variance 0 until
          // a counted quantity is submitted for them (spec §11 — only real
          // discrepancies post adjustments on approval).
          create: balances.map((b) => ({
            productId: b.productId,
            systemQtySnapshot: b.onHand,
            countedQty: b.onHand,
            variance: 0,
          })),
        },
      },
      select: { id: true, countNumber: true, _count: { select: { lines: true } } },
    });
    return { countId: count.id, countNumber: count.countNumber, lines: count._count.lines };
  }

  async submitCount(countId: string, input: SubmitCountInput, actor: Actor): Promise<unknown> {
    await this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({ where: { id: countId } });
      if (!count) throw errors.countNotFound();
      if (count.status !== 'IN_PROGRESS') throw errors.countState(count.status);
      for (const line of input.lines) {
        const existing = await tx.stockCountLine.findFirst({
          where: { id: line.lineId, stockCountId: countId },
        });
        if (!existing) continue;
        const counted = new Prisma.Decimal(line.countedQty);
        await tx.stockCountLine.update({
          where: { id: line.lineId },
          data: {
            countedQty: counted,
            variance: counted.minus(existing.systemQtySnapshot),
          },
        });
      }
      await tx.stockCount.update({
        where: { id: countId },
        data: { status: 'PENDING_APPROVAL' },
      });
    });
    void actor;
    return { countId, status: 'PENDING_APPROVAL' };
  }

  /** Approval posts one MANUAL_ADJUSTMENT per discrepant line. */
  async approveCount(countId: string, actor: Actor): Promise<unknown> {
    const branchId = this.resolveBranch(actor);
    const adjustments = await this.prisma.$transaction(async (tx) => {
      const count = await tx.stockCount.findUnique({
        where: { id: countId },
        include: { lines: { include: { product: { select: { name: true } } } } },
      });
      if (!count) throw errors.countNotFound();
      if (count.status !== 'PENDING_APPROVAL') throw errors.countState(count.status);
      let posted = 0;
      for (const line of count.lines) {
        if (line.variance.isZero()) continue;
        const updated = await tx.$executeRaw`
          UPDATE "InventoryBalance"
          SET "onHand" = "onHand" + ${line.variance}, "updatedAt" = now()
          WHERE "branchId" = ${count.branchId}::uuid AND "productId" = ${line.productId}::uuid
            AND "onHand" + ${line.variance} >= 0`;
        if (updated !== 1) throw errors.balanceNegative();
        await tx.stockMovement.create({
          data: {
            branchId: count.branchId,
            productId: line.productId,
            type: 'MANUAL_ADJUSTMENT',
            quantity: line.variance,
            reason: `Stock count ${count.countNumber}: counted ${line.countedQty.toFixed(3)} vs system ${line.systemQtySnapshot.toFixed(3)}`,
            refType: 'stock_count',
            refId: count.id,
            actorUserId: actor.id,
          },
        });
        posted++;
      }
      await tx.stockCount.update({
        where: { id: countId },
        data: { status: 'APPROVED', approvedByUserId: actor.id, approvedAt: new Date() },
      });
      return { posted };
    });
    await this.audit.log({
      actorUserId: actor.id,
      branchId,
      action: 'inventory.count.approve',
      entityType: 'StockCount',
      entityId: countId,
      metadata: { adjustments: adjustments.posted },
      requestId: actor.requestId,
    });
    return { countId, status: 'APPROVED', adjustmentsPosted: adjustments.posted };
  }

  async listCounts(branchId: string): Promise<unknown> {
    const counts = await this.prisma.stockCount.findMany({
      where: { branchId },
      orderBy: { startedAt: 'desc' },
      take: 10,
      include: { _count: { select: { lines: true } } },
    });
    return counts.map((c) => ({
      countId: c.id,
      countNumber: c.countNumber,
      status: c.status,
      lines: c._count.lines,
      startedAt: c.startedAt.toISOString(),
    }));
  }

  // --- purchase orders (minimal: create/submit/list; receiving links back) ---

  async createPurchaseOrder(input: PurchaseOrderInput, actor: Actor): Promise<unknown> {
    const branchId = this.resolveBranch(actor);
    const number = `PO-${new Date().getFullYear()}-${String(
      (await this.prisma.purchaseOrder.count()) + 1,
    ).padStart(5, '0')}`;
    const po = await this.prisma.purchaseOrder.create({
      data: {
        number,
        supplierId: input.supplierId,
        branchId,
        status: 'DRAFT',
        expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        createdByUserId: actor.id,
        notes: input.notes,
        lines: {
          create: input.lines.map((l) => ({
            productId: l.productId,
            orderedQty: l.orderedQty,
            unitCost: l.unitCost ?? '0',
          })),
        },
      },
      select: { id: true, number: true },
    });
    await this.audit.log({
      actorUserId: actor.id,
      branchId,
      action: 'inventory.po.create',
      entityType: 'PurchaseOrder',
      entityId: po.id,
      metadata: { number: po.number },
      requestId: actor.requestId,
    });
    return po;
  }

  async submitPurchaseOrder(poId: string, actor: Actor): Promise<unknown> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: poId } });
    if (!po) throw errors.poNotFound();
    if (po.status !== 'DRAFT') throw errors.poState(po.status);
    await this.prisma.purchaseOrder.update({ where: { id: poId }, data: { status: 'SUBMITTED' } });
    await this.audit.log({
      actorUserId: actor.id,
      branchId: po.branchId,
      action: 'inventory.po.submit',
      entityType: 'PurchaseOrder',
      entityId: poId,
      requestId: actor.requestId,
    });
    return { poId, status: 'SUBMITTED' };
  }

  async listPurchaseOrders(branchId: string): Promise<unknown> {
    const pos = await this.prisma.purchaseOrder.findMany({
      where: { branchId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { supplier: { select: { name: true } }, _count: { select: { lines: true } } },
    });
    return pos.map((po) => ({
      poId: po.id,
      number: po.number,
      supplier: po.supplier.name,
      status: po.status,
      lines: po._count.lines,
      expectedAt: po.expectedAt?.toISOString() ?? null,
    }));
  }
}
