/**
 * QuickMart demo seed (spec §18).
 *
 * Idempotent: every entity is upserted by a unique key, and ledger-style
 * records (stock movements, loyalty entries) are guarded so re-running never
 * double-counts. Development credentials only — never run against production.
 *
 * Run: pnpm db:seed  (via `prisma db seed` → tsx prisma/seed.ts)
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/** Fail fast when a lookup map is missing an expected key. */
function must<T>(value: T | undefined, key: string): T {
  if (value === undefined) {
    throw new Error(`Seed error: missing entry for "${key}"`);
  }
  return value;
}

const DEV_PASSWORD = 'QuickMart!dev123';

/** EAN-13 check digit from a 12-digit base (e.g. "890" + 9 digits). */
function ean13(base12: string): string {
  if (base12.length !== 12 || !/^\d{12}$/.test(base12)) {
    throw new Error(`barcode base must be 12 digits, got "${base12}"`);
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(base12[i]);
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${base12}${check}`;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

interface SeedProduct {
  name: string;
  sku: string;
  category: string;
  brand?: string;
  unit: 'PIECE' | 'PACK' | 'KG' | 'G' | 'L' | 'ML';
  price: string;
  mrp?: string;
  gst: string;
  weighed?: boolean;
  onHand: string;
  threshold: string;
}

const TAX_CATEGORIES: Array<{ name: string; rate: string }> = [
  { name: 'GST 0%', rate: '0' },
  { name: 'GST 5%', rate: '0.05' },
  { name: 'GST 12%', rate: '0.12' },
  { name: 'GST 18%', rate: '0.18' },
  { name: 'GST 28%', rate: '0.28' },
];

const CATEGORIES = [
  'Fruits & Vegetables',
  'Dairy & Eggs',
  'Bakery',
  'Staples',
  'Beverages',
  'Snacks',
  'Household',
  'Personal Care',
  'Spices & Condiments',
];

const PRODUCTS: SeedProduct[] = [
  // Fruits & Vegetables — loose, weighed, GST 0%
  {
    name: 'Tomato Loose',
    sku: 'QM-FV-001',
    category: 'Fruits & Vegetables',
    unit: 'KG',
    price: '32.00',
    gst: 'GST 0%',
    weighed: true,
    onHand: '120.500',
    threshold: '30.000',
  },
  {
    name: 'Onion Loose',
    sku: 'QM-FV-002',
    category: 'Fruits & Vegetables',
    unit: 'KG',
    price: '28.00',
    gst: 'GST 0%',
    weighed: true,
    onHand: '180.000',
    threshold: '40.000',
  },
  {
    name: 'Potato Loose',
    sku: 'QM-FV-003',
    category: 'Fruits & Vegetables',
    unit: 'KG',
    price: '24.00',
    gst: 'GST 0%',
    weighed: true,
    onHand: '200.000',
    threshold: '50.000',
  },
  {
    name: 'Banana Robusta',
    sku: 'QM-FV-004',
    category: 'Fruits & Vegetables',
    unit: 'KG',
    price: '48.00',
    gst: 'GST 0%',
    weighed: true,
    onHand: '65.000',
    threshold: '20.000',
  },
  {
    name: 'Apple Shimla',
    sku: 'QM-FV-005',
    category: 'Fruits & Vegetables',
    unit: 'KG',
    price: '180.00',
    mrp: '199.00',
    gst: 'GST 0%',
    weighed: true,
    onHand: '40.000',
    threshold: '15.000',
  },
  {
    name: 'Cucumber Loose',
    sku: 'QM-FV-006',
    category: 'Fruits & Vegetables',
    unit: 'KG',
    price: '30.00',
    gst: 'GST 0%',
    weighed: true,
    onHand: '75.000',
    threshold: '20.000',
  },
  // Dairy & Eggs
  {
    name: 'Amul Toned Milk 500ml',
    sku: 'QM-DA-001',
    category: 'Dairy & Eggs',
    brand: 'Amul',
    unit: 'PIECE',
    price: '27.00',
    gst: 'GST 0%',
    onHand: '6',
    threshold: '12',
  },
  {
    name: 'Amul Toned Milk 1L',
    sku: 'QM-DA-002',
    category: 'Dairy & Eggs',
    brand: 'Amul',
    unit: 'PIECE',
    price: '52.00',
    gst: 'GST 0%',
    onHand: '48',
    threshold: '20',
  },
  {
    name: 'Amul Butter 100g',
    sku: 'QM-DA-003',
    category: 'Dairy & Eggs',
    brand: 'Amul',
    unit: 'PIECE',
    price: '58.00',
    mrp: '60.00',
    gst: 'GST 12%',
    onHand: '35',
    threshold: '10',
  },
  {
    name: 'Amul Dahi 400g',
    sku: 'QM-DA-004',
    category: 'Dairy & Eggs',
    brand: 'Amul',
    unit: 'PIECE',
    price: '35.00',
    gst: 'GST 5%',
    onHand: '18',
    threshold: '12',
  },
  {
    name: 'Milky Mist Paneer 200g',
    sku: 'QM-DA-005',
    category: 'Dairy & Eggs',
    brand: 'Milky Mist',
    unit: 'PIECE',
    price: '85.00',
    gst: 'GST 5%',
    onHand: '12',
    threshold: '8',
  },
  {
    name: 'Egg Tray 6pc',
    sku: 'QM-DA-006',
    category: 'Dairy & Eggs',
    unit: 'PACK',
    price: '42.00',
    gst: 'GST 0%',
    onHand: '4',
    threshold: '10',
  },
  // Bakery
  {
    name: 'Britannia White Bread 400g',
    sku: 'QM-BA-001',
    category: 'Bakery',
    brand: 'Britannia',
    unit: 'PIECE',
    price: '45.00',
    mrp: '45.00',
    gst: 'GST 5%',
    onHand: '30',
    threshold: '10',
  },
  {
    name: 'Britannia Brown Bread 400g',
    sku: 'QM-BA-002',
    category: 'Bakery',
    brand: 'Britannia',
    unit: 'PIECE',
    price: '50.00',
    gst: 'GST 5%',
    onHand: '22',
    threshold: '8',
  },
  {
    name: 'Pav Buns 6pc',
    sku: 'QM-BA-003',
    category: 'Bakery',
    unit: 'PACK',
    price: '30.00',
    gst: 'GST 5%',
    onHand: '26',
    threshold: '8',
  },
  // Staples
  {
    name: 'Aashirvaad Atta 5kg',
    sku: 'QM-ST-001',
    category: 'Staples',
    brand: 'Aashirvaad',
    unit: 'PACK',
    price: '245.00',
    mrp: '260.00',
    gst: 'GST 5%',
    onHand: '42',
    threshold: '12',
  },
  {
    name: 'India Gate Basmati Rice 1kg',
    sku: 'QM-ST-002',
    category: 'Staples',
    brand: 'India Gate',
    unit: 'PACK',
    price: '135.00',
    mrp: '150.00',
    gst: 'GST 5%',
    onHand: '55',
    threshold: '15',
  },
  {
    name: 'Sona Masoori Rice 5kg',
    sku: 'QM-ST-003',
    category: 'Staples',
    unit: 'PACK',
    price: '380.00',
    gst: 'GST 5%',
    onHand: '30',
    threshold: '10',
  },
  {
    name: 'Tata Sampann Toor Dal 1kg',
    sku: 'QM-ST-004',
    category: 'Staples',
    brand: 'Tata Sampann',
    unit: 'PACK',
    price: '165.00',
    mrp: '175.00',
    gst: 'GST 5%',
    onHand: '80',
    threshold: '20',
  },
  {
    name: 'Fortune Sunflower Oil 1L',
    sku: 'QM-ST-005',
    category: 'Staples',
    brand: 'Fortune',
    unit: 'PIECE',
    price: '155.00',
    mrp: '165.00',
    gst: 'GST 5%',
    onHand: '60',
    threshold: '15',
  },
  {
    name: 'Tata Salt 1kg',
    sku: 'QM-ST-006',
    category: 'Staples',
    brand: 'Tata',
    unit: 'PIECE',
    price: '28.00',
    gst: 'GST 0%',
    onHand: '90',
    threshold: '20',
  },
  // Beverages
  {
    name: 'Real Mixed Fruit Juice 1L',
    sku: 'QM-BE-001',
    category: 'Beverages',
    brand: 'Real',
    unit: 'PIECE',
    price: '115.00',
    mrp: '125.00',
    gst: 'GST 12%',
    onHand: '38',
    threshold: '10',
  },
  {
    name: 'Tata Tea Gold 500g',
    sku: 'QM-BE-002',
    category: 'Beverages',
    brand: 'Tata Tea',
    unit: 'PIECE',
    price: '275.00',
    mrp: '285.00',
    gst: 'GST 5%',
    onHand: '25',
    threshold: '8',
  },
  {
    name: 'Nescafé Classic 50g',
    sku: 'QM-BE-003',
    category: 'Beverages',
    brand: 'Nescafé',
    unit: 'PIECE',
    price: '165.00',
    gst: 'GST 18%',
    onHand: '22',
    threshold: '8',
  },
  {
    name: 'Bisleri Water 1L',
    sku: 'QM-BE-004',
    category: 'Beverages',
    brand: 'Bisleri',
    unit: 'PIECE',
    price: '20.00',
    gst: 'GST 18%',
    onHand: '150',
    threshold: '40',
  },
  // Snacks
  {
    name: "Haldiram's Bhujia 200g",
    sku: 'QM-SN-001',
    category: 'Snacks',
    brand: "Haldiram's",
    unit: 'PIECE',
    price: '55.00',
    gst: 'GST 12%',
    onHand: '44',
    threshold: '12',
  },
  {
    name: 'Britannia Good Day Cashew 250g',
    sku: 'QM-SN-002',
    category: 'Snacks',
    brand: 'Britannia',
    unit: 'PIECE',
    price: '60.00',
    gst: 'GST 18%',
    onHand: '40',
    threshold: '12',
  },
  {
    name: "Lay's Classic Salted 52g",
    sku: 'QM-SN-003',
    category: 'Snacks',
    brand: "Lay's",
    unit: 'PIECE',
    price: '20.00',
    gst: 'GST 18%',
    onHand: '8',
    threshold: '15',
  },
  {
    name: 'Parle-G Gold 65g',
    sku: 'QM-SN-004',
    category: 'Snacks',
    brand: 'Parle-G',
    unit: 'PIECE',
    price: '10.00',
    gst: 'GST 18%',
    onHand: '120',
    threshold: '30',
  },
  // Household
  {
    name: 'Surf Excel Easy Wash 1kg',
    sku: 'QM-HH-001',
    category: 'Household',
    brand: 'Surf Excel',
    unit: 'PIECE',
    price: '145.00',
    mrp: '150.00',
    gst: 'GST 18%',
    onHand: '40',
    threshold: '10',
  },
  {
    name: 'Vim Dishwash Bar 150g',
    sku: 'QM-HH-002',
    category: 'Household',
    brand: 'Vim',
    unit: 'PIECE',
    price: '15.00',
    gst: 'GST 18%',
    onHand: '85',
    threshold: '20',
  },
  {
    name: 'Harpic Toilet Cleaner 500ml',
    sku: 'QM-HH-003',
    category: 'Household',
    brand: 'Harpic',
    unit: 'PIECE',
    price: '99.00',
    gst: 'GST 18%',
    onHand: '28',
    threshold: '8',
  },
  // Personal Care
  {
    name: 'Colgate MaxFresh 150g',
    sku: 'QM-PC-001',
    category: 'Personal Care',
    brand: 'Colgate',
    unit: 'PIECE',
    price: '105.00',
    mrp: '110.00',
    gst: 'GST 18%',
    onHand: '55',
    threshold: '15',
  },
  {
    name: 'Dove Cream Bar 100g',
    sku: 'QM-PC-002',
    category: 'Personal Care',
    brand: 'Dove',
    unit: 'PIECE',
    price: '65.00',
    gst: 'GST 18%',
    onHand: '36',
    threshold: '10',
  },
  // Spices & Condiments
  {
    name: 'Everest Turmeric Powder 100g',
    sku: 'QM-SP-001',
    category: 'Spices & Condiments',
    brand: 'Everest',
    unit: 'PIECE',
    price: '32.00',
    gst: 'GST 5%',
    onHand: '60',
    threshold: '15',
  },
  {
    name: 'Aachi Chilli Powder 200g',
    sku: 'QM-SP-002',
    category: 'Spices & Condiments',
    brand: 'Aachi',
    unit: 'PIECE',
    price: '48.00',
    gst: 'GST 5%',
    onHand: '48',
    threshold: '12',
  },
];

// Products delivered by the completed goods receipt (stock includes this delivery).
const RECEIVED = new Map<
  string,
  { qty: string; batchNumber: string; expiry: Date | null; unitCost: string }
>([
  [
    'QM-ST-004',
    { qty: '50', batchNumber: 'TD-2026-A1', expiry: daysFromNow(420), unitCost: '138.00' },
  ],
  [
    'QM-ST-005',
    { qty: '36', batchNumber: 'FO-2026-A1', expiry: daysFromNow(240), unitCost: '132.00' },
  ],
  ['QM-HH-001', { qty: '24', batchNumber: 'SE-2026-A1', expiry: null, unitCost: '121.00' }],
  ['QM-PC-001', { qty: '30', batchNumber: 'CG-2026-A1', expiry: null, unitCost: '88.00' }],
  [
    'QM-BE-003',
    { qty: '12', batchNumber: 'NC-2026-A1', expiry: daysFromNow(300), unitCost: '140.00' },
  ],
]);

async function main(): Promise<void> {
  console.log('Seeding QuickMart demo data…');

  const passwordHash = bcrypt.hashSync(DEV_PASSWORD, 10);

  // ---- Branch & settings -------------------------------------------------
  const branch = await prisma.branch.upsert({
    where: { code: 'QM-PAN' },
    update: {},
    create: {
      code: 'QM-PAN',
      name: 'QuickMart Panaji',
      address: '18 June Road, Panaji',
      city: 'Panaji',
      state: 'GA',
      pincode: '403001',
      gstin: '30ABCDE1234F1Z5',
      phone: '+91-832-4000-0001',
    },
  });

  await prisma.storeSettings.upsert({
    where: { branchId: branch.id },
    update: {},
    create: {
      branchId: branch.id,
      currency: 'INR',
      taxMode: 'TAX_EXCLUSIVE',
      roundingMode: 'HALF_UP',
      loyaltyEarnRate: '0.01',
      loyaltyRedeemRate: '1',
      loyaltyMinRedeemPoints: 50,
      loyaltyMaxRedeemPercent: '50',
      invoicePrefix: 'QM-PAN-',
      timezone: 'Asia/Kolkata',
    },
  });

  // ---- RBAC ---------------------------------------------------------------
  const permissionKeys = [
    'catalogue:read',
    'catalogue:write',
    'inventory:read',
    'inventory:receive',
    'inventory:adjust',
    'inventory:adjust:approve',
    'inventory:transfer',
    'procurement:write',
    'pos:operate',
    'pos:refund:process',
    'orders:refund:approve',
    'dashboard:view:branch',
    'dashboard:view:all',
    'settings:write',
    'users:manage',
    'audit:view',
  ] as const;

  const permissions = Object.fromEntries(
    await Promise.all(
      permissionKeys.map(async (key) => [
        key,
        await prisma.permission.upsert({
          where: { key },
          update: {},
          create: { key },
        }),
      ]),
    ),
  ) as Record<
    (typeof permissionKeys)[number],
    Awaited<ReturnType<typeof prisma.permission.upsert>>
  >;

  const roleSpec = {
    ADMIN: permissionKeys as unknown as (typeof permissionKeys)[number][],
    MANAGER: [
      'catalogue:read',
      'catalogue:write',
      'inventory:read',
      'inventory:adjust:approve',
      'orders:refund:approve',
      'procurement:write',
      'dashboard:view:branch',
      'audit:view',
    ],
    CASHIER: [
      'catalogue:read',
      'inventory:read',
      'pos:operate',
      'pos:refund:process',
      'dashboard:view:branch',
    ],
    INVENTORY_STAFF: [
      'catalogue:read',
      'inventory:read',
      'inventory:receive',
      'inventory:adjust',
      'inventory:transfer',
      'dashboard:view:branch',
    ],
  } as const;

  const roles = Object.fromEntries(
    await Promise.all(
      Object.entries(roleSpec).map(async ([name, keys]) => {
        const role = await prisma.role.upsert({
          where: { name },
          update: {},
          create: { name, description: `${name} (seeded demo role)`, isSystem: true },
        });
        await Promise.all(
          keys.map((key) =>
            prisma.rolePermission.upsert({
              where: {
                roleId_permissionId: {
                  roleId: role.id,
                  permissionId: must(permissions[key], key).id,
                },
              },
              update: {},
              create: { roleId: role.id, permissionId: must(permissions[key], key).id },
            }),
          ),
        );
        return [name, role];
      }),
    ),
  ) as Record<keyof typeof roleSpec, Awaited<ReturnType<typeof prisma.role.upsert>>>;

  const users = Object.fromEntries(
    await Promise.all(
      (
        [
          {
            email: 'admin@quickmart.dev',
            fullName: 'QuickMart Admin',
            role: 'ADMIN',
            branch: null,
          },
          {
            email: 'manager@quickmart.dev',
            fullName: 'Demo Manager',
            role: 'MANAGER',
            branch: branch.id,
          },
          {
            email: 'cashier@quickmart.dev',
            fullName: 'Demo Cashier',
            role: 'CASHIER',
            branch: branch.id,
          },
          {
            email: 'inventory@quickmart.dev',
            fullName: 'Demo Inventory',
            role: 'INVENTORY_STAFF',
            branch: branch.id,
          },
        ] as const
      ).map(async (spec) => [
        spec.email,
        await prisma.user.upsert({
          where: { email: spec.email },
          update: { fullName: spec.fullName },
          create: {
            email: spec.email,
            fullName: spec.fullName,
            passwordHash,
            branchId: spec.branch,
            roles: { create: { roleId: must(roles[spec.role], spec.role).id } },
          },
        }),
      ]),
    ),
  ) as Record<string, Awaited<ReturnType<typeof prisma.user.upsert>>>;

  // ---- Taxonomy -----------------------------------------------------------
  const taxCategories = Object.fromEntries(
    await Promise.all(
      TAX_CATEGORIES.map(async (tc) => [
        tc.name,
        await prisma.taxCategory.upsert({
          where: { name: tc.name },
          update: { rate: tc.rate },
          create: tc,
        }),
      ]),
    ),
  ) as Record<string, Awaited<ReturnType<typeof prisma.taxCategory.upsert>>>;

  const categories = Object.fromEntries(
    await Promise.all(
      CATEGORIES.map(async (name) => {
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        return [
          name,
          await prisma.category.upsert({ where: { slug }, update: {}, create: { name, slug } }),
        ];
      }),
    ),
  ) as Record<string, Awaited<ReturnType<typeof prisma.category.upsert>>>;

  const brandNames = [
    ...new Set(PRODUCTS.map((p) => p.brand).filter((b): b is string => Boolean(b))),
  ];
  const brands = Object.fromEntries(
    await Promise.all(
      brandNames.map(async (name) => {
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        return [
          name,
          await prisma.brand.upsert({ where: { slug }, update: {}, create: { name, slug } }),
        ];
      }),
    ),
  ) as Record<string, Awaited<ReturnType<typeof prisma.brand.upsert>>>;

  // ---- Products, barcodes, branch availability, inventory ------------------
  const productBySku = new Map<string, Awaited<ReturnType<typeof prisma.product.upsert>>>();
  for (const [index, spec] of PRODUCTS.entries()) {
    const product = await prisma.product.upsert({
      where: { sku: spec.sku },
      update: {
        name: spec.name,
        sellingPrice: spec.price,
        mrp: spec.mrp,
        categoryId: must(categories[spec.category], spec.category).id,
        brandId: spec.brand ? must(brands[spec.brand], spec.brand).id : null,
        taxCategoryId: must(taxCategories[spec.gst], spec.gst).id,
        isWeighed: spec.weighed ?? false,
      },
      create: {
        sku: spec.sku,
        name: spec.name,
        sellingPrice: spec.price,
        mrp: spec.mrp,
        unit: spec.unit,
        isWeighed: spec.weighed ?? false,
        categoryId: must(categories[spec.category], spec.category).id,
        brandId: spec.brand ? must(brands[spec.brand], spec.brand).id : null,
        taxCategoryId: must(taxCategories[spec.gst], spec.gst).id,
      },
    });
    productBySku.set(spec.sku, product);

    const base12 = `890${String(10_000_000 + index * 7).padStart(9, '0')}`;
    await prisma.productBarcode.upsert({
      where: { barcode: ean13(base12) },
      update: { productId: product.id },
      create: { productId: product.id, barcode: ean13(base12), format: 'EAN13', isPrimary: true },
    });

    await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: product.id } },
      update: { isAvailable: true },
      create: { branchId: branch.id, productId: product.id, isAvailable: true },
    });

    await prisma.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: product.id } },
      update: { lowStockThreshold: spec.threshold },
      create: {
        branchId: branch.id,
        productId: product.id,
        onHand: spec.onHand,
        reserved: '0',
        lowStockThreshold: spec.threshold,
      },
    });
  }

  // ---- Short-life batches (near-expiry demo data) --------------------------
  const shortLifeBatches: Array<{ sku: string; batchNumber: string; expiry: Date; qty: string }> = [
    { sku: 'QM-DA-001', batchNumber: 'MILK500-2411', expiry: daysFromNow(2), qty: '6' },
    { sku: 'QM-DA-004', batchNumber: 'DAHI-2411', expiry: daysFromNow(1), qty: '18' },
    { sku: 'QM-BA-001', batchNumber: 'BREAD-2411', expiry: daysFromNow(3), qty: '30' },
    { sku: 'QM-DA-005', batchNumber: 'PANEER-2411', expiry: daysFromNow(5), qty: '12' },
  ];
  for (const batch of shortLifeBatches) {
    await prisma.inventoryBatch.upsert({
      where: {
        branchId_productId_batchNumber: {
          branchId: branch.id,
          productId: productBySku.get(batch.sku)!.id,
          batchNumber: batch.batchNumber,
        },
      },
      update: { expiryDate: batch.expiry, quantity: batch.qty },
      create: {
        branchId: branch.id,
        productId: productBySku.get(batch.sku)!.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiry,
        quantity: batch.qty,
      },
    });
  }

  // ---- Stock movement ledger (guarded: never double-seed) ------------------
  const movementCount = await prisma.stockMovement.count({ where: { branchId: branch.id } });
  if (movementCount === 0) {
    const movements: Array<{
      productId: string;
      type: 'MANUAL_ADJUSTMENT' | 'PURCHASE_RECEIPT';
      quantity: string;
      reason: string;
      refType: string;
      batchNumber?: string;
    }> = [];
    for (const spec of PRODUCTS) {
      const product = productBySku.get(spec.sku)!;
      const received = RECEIVED.get(spec.sku);
      const initial = (Number(spec.onHand) - (received ? Number(received.qty) : 0)).toFixed(3);
      if (Number(initial) > 0) {
        movements.push({
          productId: product.id,
          type: 'MANUAL_ADJUSTMENT',
          quantity: initial,
          reason: 'Initial stock load (seed)',
          refType: 'initial_load',
        });
      }
    }
    await prisma.stockMovement.createMany({
      data: movements.map((m) => ({
        branchId: branch.id,
        productId: m.productId,
        type: m.type,
        quantity: m.quantity,
        reason: m.reason,
        refType: m.refType,
      })),
    });
  }

  // ---- Suppliers & procurement ---------------------------------------------
  const freshMart = await prisma.supplier.upsert({
    where: { name: 'FreshMart Wholesale' },
    update: {},
    create: {
      name: 'FreshMart Wholesale',
      contactName: 'Demo Contact 1',
      phone: '+91-98450-11111',
      email: 'orders@freshmart-wholesale.example',
      gstin: '29AACCF1234K1Z2',
      address: 'Panaji Market, Panaji',
    },
  });
  const dailyDairy = await prisma.supplier.upsert({
    where: { name: 'Daily Dairy Distributors' },
    update: {},
    create: {
      name: 'Daily Dairy Distributors',
      contactName: 'Demo Contact 2',
      phone: '+91-98450-22222',
      email: 'supply@dailydairy.example',
      gstin: '29AAECD5678L1Z9',
      address: 'Vasco-da-Gama Wholesale Market, Goa',
    },
  });

  const inventoryUser = must(users['inventory@quickmart.dev'], 'inventory@quickmart.dev');

  const poNumber = 'PO-2026-0001';
  const purchaseOrder = await prisma.purchaseOrder.upsert({
    where: { number: poNumber },
    update: { status: 'COMPLETED' },
    create: {
      number: poNumber,
      supplierId: freshMart.id,
      branchId: branch.id,
      status: 'SUBMITTED',
      expectedAt: daysFromNow(-7),
      createdByUserId: inventoryUser.id,
      notes: 'Weekly staples replenishment',
    },
  });
  for (const [sku, received] of RECEIVED.entries()) {
    const product = productBySku.get(sku)!;
    await prisma.purchaseOrderLine.upsert({
      where: {
        purchaseOrderId_productId: { purchaseOrderId: purchaseOrder.id, productId: product.id },
      },
      update: { receivedQty: received.qty },
      create: {
        purchaseOrderId: purchaseOrder.id,
        productId: product.id,
        orderedQty: received.qty,
        receivedQty: received.qty,
        unitCost: received.unitCost,
      },
    });
  }

  const grNumber = 'GR-2026-0001';
  const goodsReceipt = await prisma.goodsReceipt.upsert({
    where: { number: grNumber },
    update: { status: 'COMPLETED' },
    create: {
      number: grNumber,
      purchaseOrderId: purchaseOrder.id,
      branchId: branch.id,
      supplierDeliveryRef: 'FM-DN-88231',
      status: 'DRAFT',
      receivedByUserId: inventoryUser.id,
    },
  });
  const grLines = await Promise.all(
    [...RECEIVED.entries()].map(async ([sku, received]) => {
      const product = productBySku.get(sku)!;
      return prisma.goodsReceiptLine.upsert({
        where: {
          goodsReceiptId_productId_batchNumber: {
            goodsReceiptId: goodsReceipt.id,
            productId: product.id,
            batchNumber: received.batchNumber,
          },
        },
        update: {},
        create: {
          goodsReceiptId: goodsReceipt.id,
          productId: product.id,
          batchNumber: received.batchNumber,
          expiryDate: received.expiry,
          quantity: received.qty,
          unitCost: received.unitCost,
        },
      });
    }),
  );

  const grMovementsExist = await prisma.stockMovement.count({
    where: { branchId: branch.id, refType: 'goods_receipt', refId: goodsReceipt.id },
  });
  if (grMovementsExist === 0) {
    // Complete the receipt: create/refresh batches, link lines, raise balances,
    // and write PURCHASE_RECEIPT ledger movements — mirroring the runtime
    // goods-receipt completion transaction.
    await prisma.$transaction(async (tx) => {
      for (const line of grLines) {
        const batch = await tx.inventoryBatch.upsert({
          where: {
            branchId_productId_batchNumber: {
              branchId: branch.id,
              productId: line.productId,
              batchNumber: line.batchNumber,
            },
          },
          update: { quantity: { increment: line.quantity }, expiryDate: line.expiryDate },
          create: {
            branchId: branch.id,
            productId: line.productId,
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate,
            quantity: line.quantity,
          },
        });
        await tx.goodsReceiptLine.update({ where: { id: line.id }, data: { batchId: batch.id } });
        await tx.inventoryBalance.update({
          where: { branchId_productId: { branchId: branch.id, productId: line.productId } },
          data: { onHand: { increment: line.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            branchId: branch.id,
            productId: line.productId,
            batchId: batch.id,
            type: 'PURCHASE_RECEIPT',
            quantity: line.quantity,
            reason: `Goods receipt ${grNumber}`,
            refType: 'goods_receipt',
            refId: goodsReceipt.id,
            actorUserId: inventoryUser.id,
          },
        });
      }
      await tx.goodsReceipt.update({
        where: { id: goodsReceipt.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { status: 'COMPLETED' },
      });
    });
  }

  const poNumber2 = 'PO-2026-0002';
  const po2 = await prisma.purchaseOrder.upsert({
    where: { number: poNumber2 },
    update: {},
    create: {
      number: poNumber2,
      supplierId: dailyDairy.id,
      branchId: branch.id,
      status: 'SUBMITTED',
      expectedAt: daysFromNow(1),
      createdByUserId: inventoryUser.id,
      notes: 'Urgent dairy replenishment (near-expiry stock out)',
    },
  });
  for (const [sku, qty, unitCost] of [
    ['QM-DA-001', '48', '22.50'],
    ['QM-DA-006', '40', '34.00'],
    ['QM-BA-001', '60', '38.00'],
  ] as const) {
    const product = productBySku.get(sku)!;
    await prisma.purchaseOrderLine.upsert({
      where: { purchaseOrderId_productId: { purchaseOrderId: po2.id, productId: product.id } },
      update: {},
      create: { purchaseOrderId: po2.id, productId: product.id, orderedQty: qty, unitCost },
    });
  }

  // ---- Customers & loyalty ---------------------------------------------------
  const customers = [
    { name: 'Guest 1', phone: '+919845000001', email: 'guest1@example.com', bonus: 150 },
    { name: 'Guest 2', phone: '+919845000002', email: 'guest2@example.com', bonus: 80 },
    { name: 'Guest 3', phone: '+919845000003', email: null, bonus: 50 },
  ];
  for (const [index, spec] of customers.entries()) {
    const customer = await prisma.customer.upsert({
      where: { phone: spec.phone },
      update: { name: spec.name },
      create: { name: spec.name, phone: spec.phone, email: spec.email },
    });
    await prisma.loyaltyAccount.upsert({
      where: { customerId: customer.id },
      update: {},
      create: { customerId: customer.id, points: spec.bonus, lifetimeEarned: spec.bonus },
    });
    await prisma.loyaltyLedgerEntry.upsert({
      where: { idempotencyKey: `seed-signup-bonus-${index + 1}` },
      update: {},
      create: {
        accountId: (
          await prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId: customer.id } })
        ).id,
        type: 'EARN',
        pointsDelta: spec.bonus,
        balanceAfter: spec.bonus,
        idempotencyKey: `seed-signup-bonus-${index + 1}`,
        note: 'Signup bonus (seed)',
      },
    });
  }

  // ---- Promotions & coupons ---------------------------------------------------
  async function upsertPromotion(
    name: string,
    data: { kind: 'PERCENT' | 'FIXED'; value: string; maxDiscount?: string; minCartValue?: string },
  ): Promise<Awaited<ReturnType<typeof prisma.promotion.upsert>>> {
    const existing = await prisma.promotion.findFirst({ where: { name } });
    if (existing) {
      return prisma.promotion.update({
        where: { id: existing.id },
        data: { ...data, isActive: true },
      });
    }
    return prisma.promotion.create({ data: { name, ...data, isActive: true } });
  }

  const welcomePromo = await upsertPromotion('Welcome 10% off', {
    kind: 'PERCENT',
    value: '10',
    maxDiscount: '100',
    minCartValue: '500',
  });
  await prisma.coupon.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: { code: 'WELCOME10', promotionId: welcomePromo.id, isActive: true },
  });

  const save25Promo = await upsertPromotion('₹25 off ₹300', {
    kind: 'FIXED',
    value: '25',
    minCartValue: '300',
  });
  await prisma.coupon.upsert({
    where: { code: 'SAVE25' },
    update: {},
    create: { code: 'SAVE25', promotionId: save25Promo.id, isActive: true },
  });

  // ---- Open cashier shift ------------------------------------------------------
  const cashier = must(users['cashier@quickmart.dev'], 'cashier@quickmart.dev');
  const openShift = await prisma.cashierShift.findFirst({
    where: { cashierUserId: cashier.id, status: 'OPEN' },
  });
  if (!openShift) {
    await prisma.cashierShift.create({
      data: { branchId: branch.id, cashierUserId: cashier.id, openingCash: '2000' },
    });
  }

  console.log(`
Seed complete.

Branch:        ${branch.name} (${branch.code})
Products:      ${PRODUCTS.length} (with barcodes, inventory, thresholds)
Low stock:     Amul Milk 500ml, Egg Tray, Lay's
Near expiry:   Milk (2d), Dahi (1d), Bread (3d), Paneer (5d)
Purchase:      ${poNumber} (COMPLETED + ${grNumber}), ${poNumber2} (SUBMITTED)

Development logins (password: ${DEV_PASSWORD}):
  admin@quickmart.dev        ADMIN
  manager@quickmart.dev      MANAGER
  cashier@quickmart.dev      CASHIER
  inventory@quickmart.dev    INVENTORY_STAFF

Coupons: WELCOME10 (10% off ≥ ₹500, cap ₹100), SAVE25 (₹25 off ≥ ₹300)
`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
