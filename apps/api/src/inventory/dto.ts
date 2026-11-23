import { z } from 'zod';

const decimal3 = z.string().regex(/^\d{1,8}\.\d{3}$/);

export const listMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  productId: z.uuid().optional(),
  type: z
    .enum([
      'SALE',
      'RETURN',
      'PURCHASE_RECEIPT',
      'MANUAL_ADJUSTMENT',
      'TRANSFER_OUT',
      'TRANSFER_IN',
      'RESERVATION',
      'RESERVATION_RELEASE',
    ])
    .optional(),
});
export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

export const goodsReceiptSchema = z.object({
  purchaseOrderId: z.uuid().optional(),
  supplierDeliveryRef: z.string().max(60).optional(),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        batchNumber: z.string().min(1).max(60),
        expiryDate: z.string().date().optional(),
        quantity: decimal3,
        unitCost: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/)
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;

export const adjustmentSchema = z.object({
  productId: z.uuid(),
  /** Signed delta in 3-dp units ("2.000" add, "-1.500" remove). */
  quantityDelta: z.string().regex(/^-?\d{1,8}\.\d{3}$/),
  reason: z.string().min(3).max(300),
});
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;

export const createCountSchema = z.object({});
export const submitCountSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.uuid(),
        countedQty: decimal3,
      }),
    )
    .min(1),
});
export type SubmitCountInput = z.infer<typeof submitCountSchema>;

export const purchaseOrderSchema = z.object({
  supplierId: z.uuid(),
  expectedAt: z.string().date().optional(),
  notes: z.string().max(300).optional(),
  lines: z
    .array(
      z.object({
        productId: z.uuid(),
        orderedQty: decimal3,
        unitCost: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/)
          .optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
