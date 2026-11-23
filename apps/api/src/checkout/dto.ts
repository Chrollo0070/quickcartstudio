import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const createSessionSchema = z.object({
  branchId: z.uuid(),
});
export type CreateSessionInput = z.infer<typeof createSessionSchema>;

export const scanSchema = z.object({
  barcode: z
    .string()
    .min(6)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/),
});
export type ScanInput = z.infer<typeof scanSchema>;

export const updateItemSchema = z.object({
  /** Absolute quantity, 3-dp decimal string ("2.000"); ≥ 0.001. */
  quantity: z
    .string()
    .regex(/^\d{1,6}\.\d{3}$/)
    .refine((v) => Number(v) >= 0.001, {
      message: 'quantity must be at least 0.001',
    }),
});
export type UpdateItemInput = z.infer<typeof updateItemSchema>;

export const quoteSchema = z.object({
  couponCode: z.string().min(2).max(40).optional(),
  /** Loyalty points to redeem (requires a customer attached to the session). */
  loyaltyPoints: z.number().int().min(1).max(100_000).optional(),
});
export const attachCustomerSchema = z.object({
  phone: z
    .string()
    .min(8)
    .max(20)
    .regex(/^\+?[0-9]+$/),
});
export type AttachCustomerInput = z.infer<typeof attachCustomerSchema>;
export type QuoteInput = z.infer<typeof quoteSchema>;

export const confirmSchema = z.object({
  /** Client-generated UUID — retried confirms return the original order. */
  idempotencyKey: z.uuid(),
  /** Hash from the last quote; a mismatch means the cart is stale. */
  expectedQuoteHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export type ConfirmInput = z.infer<typeof confirmSchema>;

export const searchQuerySchema = z.object({
  q: z.string().min(1).max(100),
});
export type SearchQueryInput = z.infer<typeof searchQuerySchema>;

// ---------------------------------------------------------------------------
// Response shapes (plain objects documented via Swagger classes below)
// ---------------------------------------------------------------------------

export class CheckoutSessionItemDto {
  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'Amul Toned Milk 500ml' })
  name!: string;

  @ApiProperty({ example: 'QM-DA-001' })
  sku!: string;

  @ApiProperty({ example: '8900100000424' })
  barcode!: string;

  @ApiProperty({ example: 'PIECE' })
  unit!: string;

  @ApiProperty()
  isWeighed!: boolean;

  @ApiProperty({ example: '2.000' })
  quantity!: string;

  @ApiProperty({ example: '27.00', description: 'Branch-resolved unit price' })
  unitPrice!: string;
}

export class CheckoutSessionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty({ enum: ['SELF_CHECKOUT', 'POS'] })
  channel!: 'SELF_CHECKOUT' | 'POS';

  @ApiProperty({ enum: ['OPEN', 'SUSPENDED', 'EXPIRED', 'CANCELLED', 'CONVERTED'] })
  status!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: string;

  @ApiProperty({ type: [CheckoutSessionItemDto] })
  items!: CheckoutSessionItemDto[];
}

export class SearchProductDto {
  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  barcode!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  isWeighed!: boolean;

  @ApiProperty({ example: '27.00' })
  unitPrice!: string;

  @ApiProperty({ description: 'Available stock at the branch (onHand - reserved)' })
  availableStock!: string;
}

export class ConfirmResultDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ enum: ['PENDING_PAYMENT', 'COMPLETED'] })
  status!: string;

  @ApiProperty({ description: 'Final authoritative quote snapshot' })
  quote!: object;
}
