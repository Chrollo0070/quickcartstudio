import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

/** Exact decimal string with 2 fractional digits (paise) — never a JS number. */
export const decimalString = z.string().regex(/^\d+(\.\d{1,2})$/, 'e.g. "245.00"');

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().max(100).optional(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  branchId: z.uuid().optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

export const barcodeFormatSchema = z.enum(['EAN13', 'UPC_A', 'CODE128', 'OTHER']);

export const createProductSchema = z.object({
  sku: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  unit: z.enum(['PIECE', 'PACK', 'KG', 'G', 'L', 'ML']),
  sellingPrice: decimalString,
  mrp: decimalString.optional(),
  taxCategoryId: z.uuid(),
  categoryId: z.uuid().optional(),
  brandId: z.uuid().optional(),
  isWeighed: z.boolean().optional(),
  barcodes: z
    .array(
      z.object({
        barcode: z
          .string()
          .min(6)
          .max(20)
          .regex(/^[A-Za-z0-9-]+$/),
        format: barcodeFormatSchema.optional(),
        isPrimary: z.boolean().optional(),
      }),
    )
    .max(10)
    .optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema
  .omit({ sku: true, barcodes: true })
  .partial();
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const addBarcodeSchema = z.object({
  barcode: z
    .string()
    .min(6)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/),
  format: barcodeFormatSchema.optional(),
  isPrimary: z.boolean().optional(),
});
export type AddBarcodeInput = z.infer<typeof addBarcodeSchema>;

export const barcodeLookupQuerySchema = z.object({
  branchId: z.uuid().optional(),
});
export type BarcodeLookupQuery = z.infer<typeof barcodeLookupQuerySchema>;

export const createCategorySchema = z.object({
  name: z.string().min(2).max(100),
  parentId: z.uuid().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const createBrandSchema = z.object({
  name: z.string().min(1).max(100),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export class CategoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dairy & Eggs' })
  name!: string;

  @ApiProperty({ example: 'dairy-eggs' })
  slug!: string;
}

export class BrandDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Amul' })
  name!: string;
}

export class TaxCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'GST 5%' })
  name!: string;

  @ApiProperty({ example: '0.05' })
  rate!: string;
}

export class ProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'QM-DA-001' })
  sku!: string;

  @ApiProperty({ example: 'Amul Toned Milk 500ml' })
  name!: string;

  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] })
  status!: 'ACTIVE' | 'INACTIVE';

  @ApiProperty({ enum: ['PIECE', 'PACK', 'KG', 'G', 'L', 'ML'] })
  unit!: string;

  @ApiProperty({ example: '27.00' })
  sellingPrice!: string;

  @ApiProperty({ nullable: true, type: String, example: '30.00' })
  mrp!: string | null;

  @ApiProperty()
  isWeighed!: boolean;

  @ApiProperty({ type: CategoryDto, nullable: true })
  category!: CategoryDto | null;

  @ApiProperty({ type: BrandDto, nullable: true })
  brand!: BrandDto | null;

  @ApiProperty({ type: TaxCategoryDto })
  taxCategory!: TaxCategoryDto;

  @ApiProperty({ type: [String], example: ['8900100000424'] })
  barcodes!: string[];
}

export class ProductBranchInfoDto {
  @ApiProperty({ format: 'uuid' })
  branchId!: string;

  @ApiProperty()
  isAvailable!: boolean;

  @ApiProperty({ description: 'Branch override price, or null when catalogue price applies' })
  priceOverride!: string | null;

  @ApiProperty({ description: 'onHand - reserved at this branch' })
  availableStock!: string;
}

export class ProductDetailDto extends ProductDto {
  @ApiProperty({ nullable: true, type: ProductBranchInfoDto })
  branch!: ProductBranchInfoDto | null;
}
