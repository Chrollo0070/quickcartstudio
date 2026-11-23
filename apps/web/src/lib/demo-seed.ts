export interface SeedBranch {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  gstin: string;
}

export interface SeedProductSpec {
  id: string;
  name: string;
  sku: string;
  category: string;
  brand?: string;
  unit: 'PIECE' | 'PACK' | 'KG' | 'G' | 'L' | 'ML';
  price: string;
  mrp?: string;
  gstName: string;
  gstRate: number;
  weighed?: boolean;
  onHand: number;
  threshold: number;
  barcode: string;
}

export interface SeedUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  permissions: string[];
  branchId: string | null;
}

export interface SeedCustomer {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  loyaltyPoints: number;
}

export interface SeedCoupon {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: number;
  maxDiscount?: number;
  minCartValue: number;
}

export interface SeedBatch {
  batchId: string;
  productId: string;
  sku: string;
  name: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
}

export const DEMO_PASSWORD = 'QuickMart!dev123';

export const DEMO_BRANCH: SeedBranch = {
  id: 'branch-qm-pan',
  code: 'QM-PAN',
  name: 'QuickMart Panaji',
  address: '18 June Road, Panaji',
  city: 'Panaji',
  state: 'GA',
  pincode: '403001',
  gstin: '30ABCDE1234F1Z5',
};

const ALL_PERMISSIONS = [
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
];

export const DEMO_USERS: SeedUser[] = [
  {
    id: 'user-admin',
    email: 'admin@quickmart.dev',
    fullName: 'QuickMart Admin',
    roles: ['ADMIN'],
    permissions: [...ALL_PERMISSIONS],
    branchId: null,
  },
  {
    id: 'user-manager',
    email: 'manager@quickmart.dev',
    fullName: 'Demo Manager',
    roles: ['MANAGER'],
    permissions: [
      'catalogue:read',
      'catalogue:write',
      'inventory:read',
      'inventory:adjust:approve',
      'orders:refund:approve',
      'procurement:write',
      'dashboard:view:branch',
      'audit:view',
    ],
    branchId: DEMO_BRANCH.id,
  },
  {
    id: 'user-cashier',
    email: 'cashier@quickmart.dev',
    fullName: 'Demo Cashier',
    roles: ['CASHIER'],
    permissions: [
      'catalogue:read',
      'inventory:read',
      'pos:operate',
      'pos:refund:process',
      'dashboard:view:branch',
    ],
    branchId: DEMO_BRANCH.id,
  },
  {
    id: 'user-inventory',
    email: 'inventory@quickmart.dev',
    fullName: 'Demo Inventory',
    roles: ['INVENTORY_STAFF'],
    permissions: [
      'catalogue:read',
      'inventory:read',
      'inventory:receive',
      'inventory:adjust',
      'inventory:transfer',
      'dashboard:view:branch',
    ],
    branchId: DEMO_BRANCH.id,
  },
];

export const DEMO_CUSTOMERS: SeedCustomer[] = [
  {
    id: 'cust-1',
    name: 'Guest 1',
    phone: '+919845000001',
    email: 'guest1@example.com',
    loyaltyPoints: 150,
  },
  {
    id: 'cust-2',
    name: 'Guest 2',
    phone: '+919845000002',
    email: 'guest2@example.com',
    loyaltyPoints: 80,
  },
  {
    id: 'cust-3',
    name: 'Guest 3',
    phone: '+919845000003',
    email: null,
    loyaltyPoints: 50,
  },
];

export const DEMO_COUPONS: SeedCoupon[] = [
  { code: 'WELCOME10', kind: 'PERCENT', value: 10, maxDiscount: 100, minCartValue: 500 },
  { code: 'SAVE25', kind: 'FIXED', value: 25, minCartValue: 300 },
];

export function computeEan13(base12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(base12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return `${base12}${check}`;
}

const GST_RATES: Record<string, number> = {
  'GST 0%': 0,
  'GST 5%': 0.05,
  'GST 12%': 0.12,
  'GST 18%': 0.18,
  'GST 28%': 0.28,
};

interface RawProduct {
  name: string;
  sku: string;
  category: string;
  brand?: string;
  unit: 'PIECE' | 'PACK' | 'KG' | 'G' | 'L' | 'ML';
  price: string;
  mrp?: string;
  gst: string;
  weighed?: boolean;
  onHand: number;
  threshold: number;
}

const RAW_PRODUCTS: RawProduct[] = [
  { name: 'Tomato Loose', sku: 'QM-FV-001', category: 'Fruits & Vegetables', unit: 'KG', price: '32.00', gst: 'GST 0%', weighed: true, onHand: 120.5, threshold: 30 },
  { name: 'Onion Loose', sku: 'QM-FV-002', category: 'Fruits & Vegetables', unit: 'KG', price: '28.00', gst: 'GST 0%', weighed: true, onHand: 180, threshold: 40 },
  { name: 'Potato Loose', sku: 'QM-FV-003', category: 'Fruits & Vegetables', unit: 'KG', price: '24.00', gst: 'GST 0%', weighed: true, onHand: 200, threshold: 50 },
  { name: 'Banana Robusta', sku: 'QM-FV-004', category: 'Fruits & Vegetables', unit: 'KG', price: '48.00', gst: 'GST 0%', weighed: true, onHand: 65, threshold: 20 },
  { name: 'Apple Shimla', sku: 'QM-FV-005', category: 'Fruits & Vegetables', unit: 'KG', price: '180.00', mrp: '199.00', gst: 'GST 0%', weighed: true, onHand: 40, threshold: 15 },
  { name: 'Cucumber Loose', sku: 'QM-FV-006', category: 'Fruits & Vegetables', unit: 'KG', price: '30.00', gst: 'GST 0%', weighed: true, onHand: 75, threshold: 20 },
  { name: 'Amul Toned Milk 500ml', sku: 'QM-DA-001', category: 'Dairy & Eggs', brand: 'Amul', unit: 'PIECE', price: '27.00', gst: 'GST 0%', onHand: 6, threshold: 12 },
  { name: 'Amul Toned Milk 1L', sku: 'QM-DA-002', category: 'Dairy & Eggs', brand: 'Amul', unit: 'PIECE', price: '52.00', gst: 'GST 0%', onHand: 48, threshold: 20 },
  { name: 'Amul Butter 100g', sku: 'QM-DA-003', category: 'Dairy & Eggs', brand: 'Amul', unit: 'PIECE', price: '58.00', mrp: '60.00', gst: 'GST 12%', onHand: 35, threshold: 10 },
  { name: 'Amul Dahi 400g', sku: 'QM-DA-004', category: 'Dairy & Eggs', brand: 'Amul', unit: 'PIECE', price: '35.00', gst: 'GST 5%', onHand: 18, threshold: 12 },
  { name: 'Milky Mist Paneer 200g', sku: 'QM-DA-005', category: 'Dairy & Eggs', brand: 'Milky Mist', unit: 'PIECE', price: '85.00', gst: 'GST 5%', onHand: 12, threshold: 8 },
  { name: 'Egg Tray 6pc', sku: 'QM-DA-006', category: 'Dairy & Eggs', unit: 'PACK', price: '42.00', gst: 'GST 0%', onHand: 4, threshold: 10 },
  { name: 'Britannia White Bread 400g', sku: 'QM-BA-001', category: 'Bakery', brand: 'Britannia', unit: 'PIECE', price: '45.00', mrp: '45.00', gst: 'GST 5%', onHand: 30, threshold: 10 },
  { name: 'Britannia Brown Bread 400g', sku: 'QM-BA-002', category: 'Bakery', brand: 'Britannia', unit: 'PIECE', price: '50.00', gst: 'GST 5%', onHand: 22, threshold: 8 },
  { name: 'Pav Buns 6pc', sku: 'QM-BA-003', category: 'Bakery', unit: 'PACK', price: '30.00', gst: 'GST 5%', onHand: 26, threshold: 8 },
  { name: 'Aashirvaad Atta 5kg', sku: 'QM-ST-001', category: 'Staples', brand: 'Aashirvaad', unit: 'PACK', price: '245.00', mrp: '260.00', gst: 'GST 5%', onHand: 42, threshold: 12 },
  { name: 'India Gate Basmati Rice 1kg', sku: 'QM-ST-002', category: 'Staples', brand: 'India Gate', unit: 'PACK', price: '135.00', mrp: '150.00', gst: 'GST 5%', onHand: 55, threshold: 15 },
  { name: 'Sona Masoori Rice 5kg', sku: 'QM-ST-003', category: 'Staples', unit: 'PACK', price: '380.00', gst: 'GST 5%', onHand: 30, threshold: 10 },
  { name: 'Tata Sampann Toor Dal 1kg', sku: 'QM-ST-004', category: 'Staples', brand: 'Tata Sampann', unit: 'PACK', price: '165.00', mrp: '175.00', gst: 'GST 5%', onHand: 80, threshold: 20 },
  { name: 'Fortune Sunflower Oil 1L', sku: 'QM-ST-005', category: 'Staples', brand: 'Fortune', unit: 'PIECE', price: '155.00', mrp: '165.00', gst: 'GST 5%', onHand: 60, threshold: 15 },
  { name: 'Tata Salt 1kg', sku: 'QM-ST-006', category: 'Staples', brand: 'Tata', unit: 'PIECE', price: '28.00', gst: 'GST 0%', onHand: 90, threshold: 20 },
  { name: 'Real Mixed Fruit Juice 1L', sku: 'QM-BE-001', category: 'Beverages', brand: 'Real', unit: 'PIECE', price: '115.00', mrp: '125.00', gst: 'GST 12%', onHand: 38, threshold: 10 },
  { name: 'Tata Tea Gold 500g', sku: 'QM-BE-002', category: 'Beverages', brand: 'Tata Tea', unit: 'PIECE', price: '275.00', mrp: '285.00', gst: 'GST 5%', onHand: 25, threshold: 8 },
  { name: 'Nescafé Classic 50g', sku: 'QM-BE-003', category: 'Beverages', brand: 'Nescafé', unit: 'PIECE', price: '165.00', gst: 'GST 18%', onHand: 22, threshold: 8 },
  { name: 'Bisleri Water 1L', sku: 'QM-BE-004', category: 'Beverages', brand: 'Bisleri', unit: 'PIECE', price: '20.00', gst: 'GST 18%', onHand: 150, threshold: 40 },
  { name: "Haldiram's Bhujia 200g", sku: 'QM-SN-001', category: 'Snacks', brand: "Haldiram's", unit: 'PIECE', price: '55.00', gst: 'GST 12%', onHand: 44, threshold: 12 },
  { name: 'Britannia Good Day Cashew 250g', sku: 'QM-SN-002', category: 'Snacks', brand: 'Britannia', unit: 'PIECE', price: '60.00', gst: 'GST 18%', onHand: 40, threshold: 12 },
  { name: "Lay's Classic Salted 52g", sku: 'QM-SN-003', category: 'Snacks', brand: "Lay's", unit: 'PIECE', price: '20.00', gst: 'GST 18%', onHand: 8, threshold: 15 },
  { name: 'Parle-G Gold 65g', sku: 'QM-SN-004', category: 'Snacks', brand: 'Parle-G', unit: 'PIECE', price: '10.00', gst: 'GST 18%', onHand: 120, threshold: 30 },
  { name: 'Surf Excel Easy Wash 1kg', sku: 'QM-HH-001', category: 'Household', brand: 'Surf Excel', unit: 'PIECE', price: '145.00', mrp: '150.00', gst: 'GST 18%', onHand: 40, threshold: 10 },
  { name: 'Vim Dishwash Bar 150g', sku: 'QM-HH-002', category: 'Household', brand: 'Vim', unit: 'PIECE', price: '15.00', gst: 'GST 18%', onHand: 85, threshold: 20 },
  { name: 'Harpic Toilet Cleaner 500ml', sku: 'QM-HH-003', category: 'Household', brand: 'Harpic', unit: 'PIECE', price: '99.00', gst: 'GST 18%', onHand: 28, threshold: 8 },
  { name: 'Colgate MaxFresh 150g', sku: 'QM-PC-001', category: 'Personal Care', brand: 'Colgate', unit: 'PIECE', price: '105.00', mrp: '110.00', gst: 'GST 18%', onHand: 55, threshold: 15 },
  { name: 'Dove Cream Bar 100g', sku: 'QM-PC-002', category: 'Personal Care', brand: 'Dove', unit: 'PIECE', price: '65.00', gst: 'GST 18%', onHand: 36, threshold: 10 },
  { name: 'Everest Turmeric Powder 100g', sku: 'QM-SP-001', category: 'Spices & Condiments', brand: 'Everest', unit: 'PIECE', price: '32.00', gst: 'GST 5%', onHand: 60, threshold: 15 },
  { name: 'Aachi Chilli Powder 200g', sku: 'QM-SP-002', category: 'Spices & Condiments', brand: 'Aachi', unit: 'PIECE', price: '48.00', gst: 'GST 5%', onHand: 48, threshold: 12 },
];

export function buildSeedProducts(): SeedProductSpec[] {
  return RAW_PRODUCTS.map((item, index) => {
    const base12 = `890${String(10_000_000 + index * 7).padStart(9, '0')}`;
    return {
      id: `prod-${item.sku.toLowerCase()}`,
      name: item.name,
      sku: item.sku,
      category: item.category,
      brand: item.brand,
      unit: item.unit,
      price: item.price,
      mrp: item.mrp,
      gstName: item.gst,
      gstRate: GST_RATES[item.gst] ?? 0,
      weighed: item.weighed,
      onHand: item.onHand,
      threshold: item.threshold,
      barcode: computeEan13(base12),
    };
  });
}

export function buildSeedBatches(products: SeedProductSpec[]): SeedBatch[] {
  const bySku = new Map(products.map((p) => [p.sku, p]));
  const specs = [
    { sku: 'QM-DA-001', batchNumber: 'MILK500-2411', days: 2, qty: 6 },
    { sku: 'QM-DA-004', batchNumber: 'DAHI-2411', days: 1, qty: 18 },
    { sku: 'QM-BA-001', batchNumber: 'BREAD-2411', days: 3, qty: 30 },
    { sku: 'QM-DA-005', batchNumber: 'PANEER-2411', days: 5, qty: 12 },
  ];
  return specs
    .map((s) => {
      const product = bySku.get(s.sku);
      if (!product) return null;
      return {
        batchId: `batch-${s.batchNumber.toLowerCase()}`,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        batchNumber: s.batchNumber,
        expiryDate: new Date(Date.now() + s.days * 86_400_000).toISOString(),
        quantity: s.qty,
      };
    })
    .filter((b): b is SeedBatch => b !== null);
}
