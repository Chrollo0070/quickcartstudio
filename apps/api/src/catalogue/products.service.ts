import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { paginate } from '../common/utils/paginate';
import { inferBarcodeFormat } from './barcode.util';
import type { PaginatedEnvelope } from '../common/dto/pagination.dto';
import type {
  AddBarcodeInput,
  CreateBrandInput,
  CreateCategoryInput,
  CreateProductInput,
  ListProductsQuery,
  ProductDetailDto,
  ProductDto,
  TaxCategoryDto,
  UpdateProductInput,
} from './dto';

const PRODUCT_INCLUDE = {
  category: true,
  brand: true,
  taxCategory: true,
  barcodes: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
} satisfies Prisma.ProductInclude;

const BARCODE_WITH_PRODUCT = {
  product: { include: PRODUCT_INCLUDE },
} satisfies Prisma.ProductBarcodeInclude;

type ProductWithRelations = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;

function toProductDto(row: ProductWithRelations): ProductDto {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    status: row.status,
    unit: row.unit,
    // Money renders as an exact 2-dp decimal string; Decimal.toString()
    // normalises "27.00" → "27", which would corrupt the API contract.
    sellingPrice: row.sellingPrice.toFixed(2),
    mrp: row.mrp?.toFixed(2) ?? null,
    isWeighed: row.isWeighed,
    category: row.category
      ? { id: row.category.id, name: row.category.name, slug: row.category.slug }
      : null,
    brand: row.brand ? { id: row.brand.id, name: row.brand.name } : null,
    taxCategory: {
      id: row.taxCategory.id,
      name: row.taxCategory.name,
      rate: row.taxCategory.rate.toString(),
    },
    barcodes: row.barcodes.map((b) => b.barcode),
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // Branch-aware price/stock enrichment for list rows lands with Phase 2
  // (checkout sessions resolve branch context); the scan lookup already does.
  async list(
    query: ListProductsQuery,
    _branchId: string | null,
  ): Promise<PaginatedEnvelope<ProductDto>> {
    const where = {
      status: query.status,
      categoryId: query.categoryId,
      brandId: query.brandId,
      ...(query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              { sku: { contains: query.q, mode: 'insensitive' as const } },
              { barcodes: { some: { barcode: query.q } } },
            ],
          }
        : {}),
    };
    const { skip, take } = paginate(query);
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: PRODUCT_INCLUDE,
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      data: rows.map(toProductDto),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  /**
   * Barcode scan lookup: product plus branch-resolved availability, price and
   * stock (onHand - reserved). The checkout flow (Phase 2) reuses this method.
   */
  async getByBarcode(barcode: string, branchId: string | null): Promise<ProductDetailDto> {
    const found = await this.prisma.productBarcode.findUnique({
      where: { barcode },
      include: BARCODE_WITH_PRODUCT,
    });
    if (!found) {
      throw new NotFoundException({ message: 'Barcode not found', code: 'PRODUCT_NOT_FOUND' });
    }
    const dto: ProductDetailDto = { ...toProductDto(found.product), branch: null };
    if (branchId) {
      dto.branch = await this.loadBranchInfo(found.product.id, branchId);
    }
    return dto;
  }

  async getById(id: string, branchId: string | null): Promise<ProductDetailDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!product) {
      throw new NotFoundException({ message: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
    }
    const dto: ProductDetailDto = { ...toProductDto(product), branch: null };
    if (branchId) {
      dto.branch = await this.loadBranchInfo(id, branchId);
    }
    return dto;
  }

  /** Branch availability, price override and live available stock. */
  private async loadBranchInfo(
    productId: string,
    branchId: string,
  ): Promise<ProductDetailDto['branch']> {
    const [branchProduct, balance] = await Promise.all([
      this.prisma.branchProduct.findUnique({
        where: { branchId_productId: { branchId, productId } },
      }),
      this.prisma.inventoryBalance.findUnique({
        where: { branchId_productId: { branchId, productId } },
      }),
    ]);
    return {
      branchId,
      isAvailable: branchProduct?.isAvailable ?? false,
      priceOverride: branchProduct?.priceOverride?.toFixed(2) ?? null,
      availableStock: (balance ? balance.onHand.minus(balance.reserved) : 0).toFixed(3),
    };
  }

  async create(
    input: CreateProductInput,
    actor: { id: string; requestId?: string },
  ): Promise<ProductDto> {
    const existing = await this.prisma.product.findFirst({
      where: {
        OR: [
          { sku: input.sku },
          ...(input.barcodes ?? []).map((b) => ({ barcodes: { some: { barcode: b.barcode } } })),
        ],
      },
      select: { sku: true, barcodes: { select: { barcode: true } } },
    });
    if (existing) {
      throw new ConflictException({
        message: 'SKU or barcode already exists',
        code: 'PRODUCT_DUPLICATE',
      });
    }

    const product = await this.prisma.product.create({
      data: {
        sku: input.sku,
        name: input.name,
        description: input.description,
        unit: input.unit,
        sellingPrice: input.sellingPrice,
        mrp: input.mrp,
        isWeighed: input.isWeighed ?? false,
        taxCategoryId: input.taxCategoryId,
        categoryId: input.categoryId,
        brandId: input.brandId,
        barcodes: {
          create: (input.barcodes ?? []).map((b) => ({
            barcode: b.barcode,
            format: b.format ?? inferBarcodeFormat(b.barcode),
            isPrimary: b.isPrimary ?? false,
          })),
        },
      },
      include: PRODUCT_INCLUDE,
    });

    // Every active branch starts selling the product (per-branch overrides come later).
    await this.prisma.branchProduct.createMany({
      data: (
        await this.prisma.branch.findMany({ where: { isActive: true }, select: { id: true } })
      ).map((branch) => ({ branchId: branch.id, productId: product.id, isAvailable: true })),
    });

    await this.audit.log({
      actorUserId: actor.id,
      action: 'catalogue.product.create',
      entityType: 'Product',
      entityId: product.id,
      metadata: { sku: product.sku, name: product.name },
      requestId: actor.requestId,
    });
    return toProductDto(product);
  }

  async update(
    id: string,
    input: UpdateProductInput,
    actor: { id: string; requestId?: string },
  ): Promise<ProductDto> {
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        unit: input.unit,
        sellingPrice: input.sellingPrice,
        mrp: input.mrp,
        isWeighed: input.isWeighed,
        taxCategoryId: input.taxCategoryId,
        categoryId: input.categoryId,
        brandId: input.brandId,
        // status changes go through the dedicated lifecycle endpoint later;
        // direct status edits here would bypass low-stock/expiry workflows.
      },
      include: PRODUCT_INCLUDE,
    });
    await this.audit.log({
      actorUserId: actor.id,
      action: 'catalogue.product.update',
      entityType: 'Product',
      entityId: product.id,
      metadata: { fields: Object.keys(input) },
      requestId: actor.requestId,
    });
    return toProductDto(product);
  }

  async addBarcode(
    productId: string,
    input: AddBarcodeInput,
    actor: { id: string; requestId?: string },
  ): Promise<ProductDto> {
    await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { id: true } });
    const duplicate = await this.prisma.productBarcode.findUnique({
      where: { barcode: input.barcode },
    });
    if (duplicate) {
      throw new ConflictException({
        message: 'Barcode already registered',
        code: 'BARCODE_EXISTS',
      });
    }
    await this.prisma.productBarcode.create({
      data: {
        productId,
        barcode: input.barcode,
        format: input.format ?? inferBarcodeFormat(input.barcode),
        isPrimary: input.isPrimary ?? false,
      },
    });
    await this.audit.log({
      actorUserId: actor.id,
      action: 'catalogue.product.barcode.add',
      entityType: 'ProductBarcode',
      entityId: productId,
      metadata: { barcode: input.barcode },
      requestId: actor.requestId,
    });
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
    return toProductDto(product);
  }

  async removeBarcode(
    productId: string,
    barcodeId: string,
    actor: { id: string; requestId?: string },
  ): Promise<ProductDto> {
    const barcode = await this.prisma.productBarcode.findUnique({ where: { id: barcodeId } });
    if (!barcode || barcode.productId !== productId) {
      throw new NotFoundException({ message: 'Barcode not found', code: 'BARCODE_NOT_FOUND' });
    }
    const remaining = await this.prisma.productBarcode.count({ where: { productId } });
    if (remaining <= 1) {
      throw new ConflictException({
        message: 'A product must keep at least one barcode',
        code: 'LAST_BARCODE',
      });
    }
    await this.prisma.productBarcode.delete({ where: { id: barcodeId } });
    await this.audit.log({
      actorUserId: actor.id,
      action: 'catalogue.product.barcode.remove',
      entityType: 'ProductBarcode',
      entityId: productId,
      metadata: { barcode: barcode.barcode },
      requestId: actor.requestId,
    });
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: PRODUCT_INCLUDE,
    });
    return toProductDto(product);
  }

  async listTaxCategories(): Promise<TaxCategoryDto[]> {
    const rows = await this.prisma.taxCategory.findMany({
      where: { isActive: true },
      orderBy: { rate: 'asc' },
    });
    return rows.map((row) => ({ id: row.id, name: row.name, rate: row.rate.toString() }));
  }

  async createCategory(input: CreateCategoryInput, actor: { id: string; requestId?: string }) {
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const category = await this.prisma.category.upsert({
      where: { slug },
      update: { parentId: input.parentId },
      create: { name: input.name, slug, parentId: input.parentId },
    });
    await this.audit.log({
      actorUserId: actor.id,
      action: 'catalogue.category.create',
      entityType: 'Category',
      entityId: category.id,
      metadata: { name: category.name },
      requestId: actor.requestId,
    });
    return { id: category.id, name: category.name, slug: category.slug };
  }

  async createBrand(input: CreateBrandInput, actor: { id: string; requestId?: string }) {
    const slug = input.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const brand = await this.prisma.brand.upsert({
      where: { slug },
      update: {},
      create: { name: input.name, slug },
    });
    await this.audit.log({
      actorUserId: actor.id,
      action: 'catalogue.brand.create',
      entityType: 'Brand',
      entityId: brand.id,
      metadata: { name: brand.name },
      requestId: actor.requestId,
    });
    return { id: brand.id, name: brand.name };
  }
}
