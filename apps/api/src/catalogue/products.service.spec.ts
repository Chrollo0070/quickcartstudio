import { NotFoundException } from '@nestjs/common';
import { jest, describe, expect, it } from '@jest/globals';
import { Prisma } from '../generated/prisma/client';
import { ProductsService } from './products.service';

function makeService() {
  const prisma = {
    product: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      findFirst: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      update: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      count: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    productBarcode: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      delete: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
      count: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
    branchProduct: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
      createMany: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ count: 1 }),
    },
    inventoryBalance: {
      findUnique: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
    },
    branch: { findMany: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([]) },
    category: { upsert: jest.fn<(...args: unknown[]) => Promise<unknown>>() },
    brand: { upsert: jest.fn<(...args: unknown[]) => Promise<unknown>>() },
  };
  const audit = { log: jest.fn<() => Promise<void>>().mockResolvedValue(undefined) };
  const service = new ProductsService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const productRow = {
  id: '33333333-3333-4333-8333-333333333333',
  sku: 'QM-DA-001',
  name: 'Amul Toned Milk 500ml',
  description: null,
  status: 'ACTIVE' as const,
  unit: 'PIECE',
  sellingPrice: new Prisma.Decimal('27.00'),
  mrp: new Prisma.Decimal('30.00'),
  taxInclusive: null,
  isWeighed: false,
  isAgeRestricted: false,
  requiresStaffAssistance: false,
  imageUrl: null,
  categoryId: null,
  brandId: '44444444-4444-4444-8444-444444444444',
  taxCategoryId: '55555555-5555-4555-8555-555555555555',
  createdAt: new Date(),
  updatedAt: new Date(),
  category: null,
  brand: { id: '44444444-4444-4444-8444-444444444444', name: 'Amul' },
  taxCategory: {
    id: '55555555-5555-4555-8555-555555555555',
    name: 'GST 0%',
    rate: new Prisma.Decimal('0'),
  },
  barcodes: [{ barcode: '8900100000424', isPrimary: true, createdAt: new Date() }],
};

const branchId = '22222222-2222-4222-8222-222222222222';

describe('ProductsService.getByBarcode', () => {
  it('throws PRODUCT_NOT_FOUND for an unknown barcode', async () => {
    const { service, prisma } = makeService();
    prisma.productBarcode.findUnique.mockResolvedValue(null);
    await expect(service.getByBarcode('9999999999999', null)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRODUCT_NOT_FOUND' }),
    });
  });

  it('returns the product without branch info when no branch is resolved', async () => {
    const { service, prisma } = makeService();
    prisma.productBarcode.findUnique.mockResolvedValue({ product: productRow });
    const dto = await service.getByBarcode('8900100000424', null);
    expect(dto.sellingPrice).toBe('27.00');
    expect(dto.barcodes).toEqual(['8900100000424']);
    expect(dto.branch).toBeNull();
  });

  it('resolves branch availability, price override and available stock', async () => {
    const { service, prisma } = makeService();
    prisma.productBarcode.findUnique.mockResolvedValue({ product: productRow });
    prisma.branchProduct.findUnique.mockResolvedValue({
      branchId,
      productId: productRow.id,
      priceOverride: new Prisma.Decimal('26.00'),
      isAvailable: true,
    });
    prisma.inventoryBalance.findUnique.mockResolvedValue({
      onHand: new Prisma.Decimal('50.000'),
      reserved: new Prisma.Decimal('2.000'),
    });
    const dto = await service.getByBarcode('8900100000424', branchId);
    expect(dto.branch).toMatchObject({
      isAvailable: true,
      priceOverride: '26.00',
      availableStock: '48.000',
    });
  });

  it('reports unavailable stock when no balance row exists yet', async () => {
    const { service, prisma } = makeService();
    prisma.productBarcode.findUnique.mockResolvedValue({ product: productRow });
    prisma.branchProduct.findUnique.mockResolvedValue(null);
    const dto = await service.getByBarcode('8900100000424', branchId);
    expect(dto.branch).toMatchObject({ isAvailable: false, availableStock: '0.000' });
  });
});

describe('ProductsService.create', () => {
  const input = {
    sku: 'QM-XX-001',
    name: 'Test Product',
    unit: 'PIECE' as const,
    sellingPrice: '10.00',
    taxCategoryId: '55555555-5555-4555-8555-555555555555',
    barcodes: [{ barcode: '8900100000998', isPrimary: true }], // valid EAN-13 check digit
  };

  it('creates the product, its barcodes, and branch availability for active branches', async () => {
    const { service, prisma } = makeService();
    prisma.product.create.mockResolvedValue(productRow);
    prisma.branch.findMany.mockResolvedValue([{ id: branchId }]);
    const dto = await service.create(input, { id: 'admin' });
    expect(dto.sku).toBe('QM-DA-001');
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sku: 'QM-XX-001',
          barcodes: {
            create: [expect.objectContaining({ barcode: '8900100000998', format: 'EAN13' })],
          },
        }),
      }),
    );
    // BranchProduct rows are created per active branch
    expect(prisma.branch.findMany).toHaveBeenCalled();
    expect(prisma.productBarcode.count).not.toHaveBeenCalled();
  });

  it('rejects duplicate SKUs with PRODUCT_DUPLICATE', async () => {
    const { service, prisma } = makeService();
    prisma.product.findFirst.mockResolvedValue({ sku: 'QM-DA-001', barcodes: [] });
    await expect(service.create(input, { id: 'admin' })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PRODUCT_DUPLICATE' }),
    });
  });
});

describe('ProductsService barcode management', () => {
  it('rejects registering an already-used barcode', async () => {
    const { service, prisma } = makeService();
    prisma.product.findUniqueOrThrow.mockResolvedValue({ id: productRow.id });
    prisma.productBarcode.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(
      service.addBarcode(productRow.id, { barcode: '8900100000424' }, { id: 'admin' }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BARCODE_EXISTS' }) });
  });

  it('refuses to remove the last remaining barcode', async () => {
    const { service, prisma } = makeService();
    prisma.productBarcode.findUnique.mockResolvedValue({
      id: 'b1',
      productId: productRow.id,
      barcode: '8900100000424',
    });
    prisma.productBarcode.count.mockResolvedValue(1);
    await expect(service.removeBarcode(productRow.id, 'b1', { id: 'admin' })).rejects.toMatchObject(
      { response: expect.objectContaining({ code: 'LAST_BARCODE' }) },
    );
  });

  it('only removes barcodes that belong to the product', async () => {
    const { service, prisma } = makeService();
    prisma.productBarcode.findUnique.mockResolvedValue({
      id: 'b2',
      productId: 'other-product',
      barcode: '8900100000998',
    });
    await expect(service.removeBarcode(productRow.id, 'b2', { id: 'admin' })).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.productBarcode.delete).not.toHaveBeenCalled();
  });
});
