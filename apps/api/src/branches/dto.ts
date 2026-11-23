import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const createBranchSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'uppercase letters, digits and dashes'),
  name: z.string().min(2).max(120),
  address: z.string().max(300).optional(),
  city: z.string().max(100).optional(),
  state: z.string().min(2).max(4).optional(),
  pincode: z.string().min(5).max(10).optional(),
  gstin: z.string().min(15).max(15).optional(),
  phone: z.string().max(20).optional(),
});
export type CreateBranchInput = z.infer<typeof createBranchSchema>;

export const updateBranchSchema = createBranchSchema.partial();
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;

export const updateStoreSettingsSchema = z.object({
  taxMode: z.enum(['TAX_INCLUSIVE', 'TAX_EXCLUSIVE']).optional(),
  roundingMode: z.enum(['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL']).optional(),
  loyaltyEarnRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  loyaltyRedeemRate: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .optional(),
  loyaltyMinRedeemPoints: z.number().int().min(0).optional(),
  loyaltyMaxRedeemPercent: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .optional(),
  invoicePrefix: z.string().min(1).max(20).optional(),
  timezone: z.string().min(3).max(60).optional(),
});
export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;

export class BranchDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'QM-IND' })
  code!: string;

  @ApiProperty({ example: 'QuickMart Indiranagar' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  address!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'Bengaluru' })
  city!: string | null;

  @ApiProperty({ nullable: true, type: String, example: 'KA' })
  state!: string | null;

  @ApiProperty({ nullable: true, type: String })
  gstin!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty()
  isActive!: boolean;
}

/** Public store listing shape (no settings internals). */
export class PublicBranchDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'QM-IND' })
  code!: string;

  @ApiProperty({ example: 'QuickMart Indiranagar' })
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  city!: string | null;
}

export class StoreSettingsDto {
  @ApiProperty({ enum: ['TAX_INCLUSIVE', 'TAX_EXCLUSIVE'] })
  taxMode!: 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE';

  @ApiProperty({ enum: ['HALF_UP', 'HALF_EVEN', 'FLOOR', 'CEIL'] })
  roundingMode!: string;

  @ApiProperty({ example: '0.01' })
  loyaltyEarnRate!: string;

  @ApiProperty({ example: '1' })
  loyaltyRedeemRate!: string;

  @ApiProperty()
  loyaltyMinRedeemPoints!: number;

  @ApiProperty({ example: '50' })
  loyaltyMaxRedeemPercent!: string;

  @ApiProperty({ example: 'QM-IND-' })
  invoicePrefix!: string;

  @ApiProperty({ example: 'Asia/Kolkata' })
  timezone!: string;
}
