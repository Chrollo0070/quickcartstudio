import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SERVICE_NAME } from '@quickcart/shared';
import {
  buildSeedBatches,
  buildSeedProducts,
  DEMO_BRANCH,
  DEMO_COUPONS,
  DEMO_CUSTOMERS,
  DEMO_PASSWORD,
  DEMO_USERS,
  type SeedBatch,
  type SeedCustomer,
  type SeedProductSpec,
  type SeedUser,
} from './demo-seed';

export interface BackendRequest {
  method: string;
  segments: string[];
  query: URLSearchParams;
  body: unknown;
  authorization: string | null;
  sessionToken: string | null;
  refreshCookie: string | null;
}

export interface BackendResponse {
  status: number;
  body: unknown;
  setRefreshCookie?: string | null;
}

interface SessionItemRecord {
  itemId: string;
  productId: string;
  quantity: number;
}

interface CheckoutSessionRecord {
  id: string;
  token: string;
  branchId: string;
  channel: 'SELF_CHECKOUT' | 'POS';
  status: 'OPEN' | 'SUSPENDED' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  customerId: string | null;
  items: SessionItemRecord[];
  lastCouponCode: string | null;
  lastLoyaltyPoints: number;
}

interface OrderLineRecord {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  lineSubtotal: number;
  lineTaxTotal: number;
  lineTotal: number;
  taxableValue: number;
  taxLines: Array<{ name: 'CGST' | 'SGST' | 'IGST'; rate: string; basisAmount: string; amount: string }>;
}

interface OrderRecord {
  id: string;
  sessionId: string;
  channel: 'SELF_CHECKOUT' | 'POS';
  status: 'PENDING_PAYMENT' | 'COMPLETED' | 'REFUNDED';
  placedAt: string;
  receiptNumber: string | null;
  provider: string;
  subtotal: number;
  itemDiscountTotal: number;
  couponDiscountTotal: number;
  taxTotal: number;
  grandTotal: number;
  lines: OrderLineRecord[];
  idempotencyKey: string;
}

interface PaymentRecord {
  id: string;
  orderId: string;
  provider: string;
  providerRef: string;
  status: 'PENDING' | 'SETTLED';
  idempotencyKey: string;
}

interface RefundRecord {
  refundId: string;
  orderId: string;
  amount: string;
  currency: string;
  reason: string;
  status: 'PENDING_APPROVAL' | 'APPROVED';
  requestedAt: string;
}

interface MovementRecord {
  id: string;
  productId: string;
  type: string;
  quantity: string;
  reason: string | null;
  createdAt: string;
}

interface CountRecord {
  countId: string;
  countNumber: string;
  status: 'PENDING_APPROVAL' | 'APPROVED';
  lines: number;
  startedAt: string;
}

interface ShiftRecord {
  id: string;
  openedAt: string;
  openingCash: number;
  orders: number;
  cashOrders: number;
  cashCollected: number;
  cardOrders: number;
  cardCollected: number;
  closed: boolean;
}

export interface ShiftZReportRecord {
  reportNumber: string;
  shiftId: string;
  openedAt: string;
  closedAt: string;
  closedBy: string;
  orders: number;
  cashOrders: number;
  cardOrders: number;
  openingCash: string;
  cashCollected: string;
  cardCollected: string;
  grossSales: string;
  expectedDrawer: string;
  countedCash: string;
  variance: string;
  notes: string | null;
}

interface PersistedStoreSnapshot {
  version: 1;
  savedAt: string;
  stockOnHand: Record<string, number>;
  orders: OrderRecord[];
  movements: MovementRecord[];
  counts: CountRecord[];
  refunds: RefundRecord[];
  currentShift: ShiftRecord;
  shiftHistory: ShiftZReportRecord[];
  receiptCounter: number;
  countCounter: number;
  goodsReceiptCounter: number;
  zReportCounter: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function fmt2(n: number): string {
  return round2(n).toFixed(2);
}

function fmt3(n: number): string {
  return (Math.round((n + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function fail(status: number, message: string, code?: string): BackendResponse {
  return { status, body: code ? { message, code } : { message } };
}

export class DemoBackend {
  private readonly startedAt = Date.now();
  private readonly products: SeedProductSpec[];
  private readonly productById: Map<string, SeedProductSpec>;
  private readonly productByBarcode: Map<string, SeedProductSpec>;
  private readonly stockOnHand: Map<string, number>;
  private readonly stockReserved: Map<string, number>;
  private readonly batches: SeedBatch[];
  private readonly customers: Map<string, SeedCustomer>;
  private readonly usersByEmail: Map<string, SeedUser>;
  private readonly usersById: Map<string, SeedUser>;
  private readonly lastLoginByUserId = new Map<string, string>();
  private readonly accessTokens = new Map<string, string>();
  private readonly refreshTokens = new Map<string, string>();
  private readonly sessions = new Map<string, CheckoutSessionRecord>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly orderByIdempotency = new Map<string, OrderRecord>();
  private readonly payments = new Map<string, PaymentRecord>();
  private readonly refunds = new Map<string, RefundRecord>();
  private readonly movements: MovementRecord[] = [];
  private readonly counts: CountRecord[] = [];
  private readonly shiftHistory: ShiftZReportRecord[] = [];
  private readonly storageFile: string | null;
  private currentShift: ShiftRecord;
  private receiptCounter = 1001;
  private countCounter = 1;
  private goodsReceiptCounter = 2;
  private zReportCounter = 1;

  constructor(dataDir: string | null = process.env.QUICKCART_DATA_DIR?.trim() || null) {
    this.storageFile = dataDir
      ? path.join(/*turbopackIgnore: true*/ path.resolve(/*turbopackIgnore: true*/ dataDir), 'quickcart-store.json')
      : null;
    this.products = buildSeedProducts();
    this.productById = new Map(this.products.map((p) => [p.id, p]));
    this.productByBarcode = new Map(this.products.map((p) => [p.barcode, p]));
    this.stockOnHand = new Map(this.products.map((p) => [p.id, p.onHand]));
    this.stockReserved = new Map(this.products.map((p) => [p.id, 0]));
    this.batches = buildSeedBatches(this.products);
    this.customers = new Map(DEMO_CUSTOMERS.map((c) => [c.phone, { ...c }]));
    this.usersByEmail = new Map(DEMO_USERS.map((u) => [u.email.toLowerCase(), u]));
    this.usersById = new Map(DEMO_USERS.map((u) => [u.id, u]));
    this.currentShift = {
      id: 'shift-demo-1',
      openedAt: new Date().toISOString(),
      openingCash: 2000,
      orders: 0,
      cashOrders: 0,
      cashCollected: 0,
      cardOrders: 0,
      cardCollected: 0,
      closed: false,
    };
    this.hydrateFromDisk();
  }

  private hydrateFromDisk(): void {
    if (!this.storageFile || !fs.existsSync(this.storageFile)) return;
    try {
      const raw = fs.readFileSync(this.storageFile, 'utf8');
      const snap = JSON.parse(raw) as Partial<PersistedStoreSnapshot>;
      if (snap.version !== 1) return;
      if (snap.stockOnHand) {
        for (const [productId, qty] of Object.entries(snap.stockOnHand)) {
          if (this.productById.has(productId) && Number.isFinite(qty)) {
            this.stockOnHand.set(productId, qty);
          }
        }
      }
      if (Array.isArray(snap.orders)) {
        for (const order of snap.orders) {
          this.orders.set(order.id, order);
          this.orderByIdempotency.set(order.idempotencyKey, order);
        }
      }
      if (Array.isArray(snap.movements)) {
        this.movements.push(...snap.movements);
      }
      if (Array.isArray(snap.counts)) {
        this.counts.push(...snap.counts);
      }
      if (Array.isArray(snap.refunds)) {
        for (const r of snap.refunds) this.refunds.set(r.refundId, r);
      }
      if (snap.currentShift) {
        this.currentShift = {
          ...snap.currentShift,
          cardOrders: snap.currentShift.cardOrders ?? 0,
          cardCollected: snap.currentShift.cardCollected ?? 0,
        };
      }
      if (Array.isArray(snap.shiftHistory)) {
        this.shiftHistory.push(...snap.shiftHistory);
      }
      if (typeof snap.receiptCounter === 'number') this.receiptCounter = snap.receiptCounter;
      if (typeof snap.countCounter === 'number') this.countCounter = snap.countCounter;
      if (typeof snap.goodsReceiptCounter === 'number') {
        this.goodsReceiptCounter = snap.goodsReceiptCounter;
      }
      if (typeof snap.zReportCounter === 'number') this.zReportCounter = snap.zReportCounter;
    } catch {
      // Ignore corrupt snapshot and fall back cleanly to seeded baseline
    }
  }

  private persistToDisk(): void {
    if (!this.storageFile) return;
    try {
      const dir = path.dirname(this.storageFile);
      fs.mkdirSync(dir, { recursive: true });
      const snapshot: PersistedStoreSnapshot = {
        version: 1,
        savedAt: new Date().toISOString(),
        stockOnHand: Object.fromEntries(this.stockOnHand.entries()),
        orders: [...this.orders.values()],
        movements: this.movements.slice(0, 500),
        counts: this.counts.slice(0, 100),
        refunds: [...this.refunds.values()],
        currentShift: this.currentShift,
        shiftHistory: this.shiftHistory.slice(0, 50),
        receiptCounter: this.receiptCounter,
        countCounter: this.countCounter,
        goodsReceiptCounter: this.goodsReceiptCounter,
        zReportCounter: this.zReportCounter,
      };
      const tmpPath = `${this.storageFile}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storageFile);
    } catch {
      // Never block POS mutations if local disk is read-only
    }
  }

  private availableOf(productId: string): number {
    const onHand = this.stockOnHand.get(productId) ?? 0;
    const reserved = this.stockReserved.get(productId) ?? 0;
    return Math.max(0, round2((onHand - reserved) * 10) / 10);
  }

  private serializeProduct(p: SeedProductSpec) {
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      status: 'ACTIVE' as const,
      unit: p.unit,
      sellingPrice: p.price,
      mrp: p.mrp ?? null,
      isWeighed: Boolean(p.weighed),
      category: { id: `cat-${slugify(p.category)}`, name: p.category, slug: slugify(p.category) },
      brand: p.brand ? { id: `brand-${slugify(p.brand)}`, name: p.brand } : null,
      taxCategory: { id: `tax-${slugify(p.gstName)}`, name: p.gstName, rate: String(p.gstRate) },
      barcodes: [p.barcode],
    };
  }

  private resolveStaffUser(req: BackendRequest): SeedUser | null {
    const auth = req.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const token = auth.slice('Bearer '.length).trim();
    const userId = this.accessTokens.get(token);
    if (!userId) return null;
    return this.usersById.get(userId) ?? null;
  }

  private requireStaff(req: BackendRequest, permission?: string): SeedUser | BackendResponse {
    const user = this.resolveStaffUser(req);
    if (!user) return fail(401, 'Unauthorized', 'UNAUTHORIZED');
    if (permission && !user.permissions.includes(permission)) {
      return fail(403, 'Forbidden', 'FORBIDDEN');
    }
    return user;
  }

  private authorizeSession(req: BackendRequest, sessionId: string): CheckoutSessionRecord | BackendResponse {
    const session = this.sessions.get(sessionId);
    if (!session) return fail(404, 'Checkout session not found', 'SESSION_NOT_FOUND');
    if (session.channel === 'POS') {
      const staff = this.resolveStaffUser(req);
      if (staff) return session;
    }
    if (req.sessionToken && req.sessionToken === session.token) {
      return session;
    }
    if (this.resolveStaffUser(req)) {
      return session;
    }
    return fail(401, 'Invalid session token', 'INVALID_SESSION_TOKEN');
  }

  private serializeSession(session: CheckoutSessionRecord) {
    return {
      id: session.id,
      branchId: session.branchId,
      channel: session.channel,
      status: session.status,
      expiresAt: session.expiresAt,
      items: session.items.map((item) => {
        const p = this.productById.get(item.productId)!;
        return {
          itemId: item.itemId,
          productId: p.id,
          name: p.name,
          sku: p.sku,
          barcode: p.barcode,
          unit: p.unit,
          isWeighed: Boolean(p.weighed),
          quantity: fmt3(item.quantity),
          unitPrice: p.price,
          availableStock: fmt3(this.availableOf(p.id)),
        };
      }),
    };
  }

  private computeQuote(
    session: CheckoutSessionRecord,
    couponCode?: string,
    loyaltyPointsRequested?: number,
  ) {
    const rawSubtotal = session.items.reduce((sum, item) => {
      const p = this.productById.get(item.productId)!;
      return sum + Number(p.price) * item.quantity;
    }, 0);
    const subtotal = round2(rawSubtotal);

    let couponDiscount = 0;
    let couponApplied: { code: string; discount: string } | null = null;
    let couponError: string | undefined;

    if (couponCode) {
      const normalized = couponCode.trim().toUpperCase();
      const coupon = DEMO_COUPONS.find((c) => c.code === normalized);
      if (!coupon) {
        couponError = 'COUPON_INVALID';
      } else if (subtotal < coupon.minCartValue) {
        couponError = 'COUPON_MIN_CART_NOT_MET';
      } else {
        const raw =
          coupon.kind === 'PERCENT' ? (subtotal * coupon.value) / 100 : coupon.value;
        couponDiscount = round2(
          coupon.maxDiscount ? Math.min(raw, coupon.maxDiscount) : Math.min(raw, subtotal),
        );
        couponApplied = { code: coupon.code, discount: fmt2(couponDiscount) };
      }
    }

    let loyaltyDiscount = 0;
    let loyaltyApplied: { points: number; discount: string } | null = null;
    if (loyaltyPointsRequested && loyaltyPointsRequested > 0 && session.customerId) {
      const customer = [...this.customers.values()].find((c) => c.id === session.customerId);
      if (customer && customer.loyaltyPoints >= 50) {
        const maxPoints = Math.min(
          customer.loyaltyPoints,
          loyaltyPointsRequested,
          Math.floor((subtotal - couponDiscount) * 0.5),
        );
        if (maxPoints > 0) {
          loyaltyDiscount = round2(maxPoints);
          loyaltyApplied = { points: maxPoints, discount: fmt2(loyaltyDiscount) };
        }
      }
    }

    const totalDiscount = round2(couponDiscount + loyaltyDiscount);
    const discountRatio = subtotal > 0 ? totalDiscount / subtotal : 0;

    let taxTotal = 0;
    const lines = session.items.map((item) => {
      const p = this.productById.get(item.productId)!;
      const lineSub = round2(Number(p.price) * item.quantity);
      const lineDiscount = round2(lineSub * discountRatio);
      const taxable = round2(Math.max(0, lineSub - lineDiscount));
      const lineTax = round2(taxable * p.gstRate);
      const halfRate = p.gstRate / 2;
      const cgst = round2(lineTax / 2);
      const sgst = round2(lineTax - cgst);
      taxTotal = round2(taxTotal + lineTax);
      const lineTotal = round2(taxable + lineTax);
      return {
        productId: p.id,
        name: p.name,
        quantity: fmt3(item.quantity),
        unitPrice: p.price,
        lineSubtotal: fmt2(lineSub),
        lineDiscountTotal: fmt2(lineDiscount),
        taxableValue: fmt2(taxable),
        lineTaxTotal: fmt2(lineTax),
        lineTotal: fmt2(lineTotal),
        taxSplit: 'CGST_SGST' as const,
        taxLines:
          p.gstRate > 0
            ? [
                { name: 'CGST' as const, rate: String(halfRate), basisAmount: fmt2(taxable), amount: fmt2(cgst) },
                { name: 'SGST' as const, rate: String(halfRate), basisAmount: fmt2(taxable), amount: fmt2(sgst) },
              ]
            : [],
      };
    });

    const grandTotal = round2(Math.max(0, subtotal - totalDiscount) + taxTotal);
    const hashPayload = JSON.stringify({
      items: session.items.map((i) => [i.productId, fmt3(i.quantity)]),
      couponCode: couponApplied?.code ?? null,
      loyaltyPoints: loyaltyApplied?.points ?? 0,
      grandTotal: fmt2(grandTotal),
    });
    const hash = crypto.createHash('sha256').update(hashPayload).digest('hex').slice(0, 16);

    return {
      currency: 'INR',
      subtotal: fmt2(subtotal),
      itemDiscountTotal: fmt2(loyaltyDiscount),
      couponDiscountTotal: fmt2(couponDiscount),
      taxTotal: fmt2(taxTotal),
      grandTotal: fmt2(grandTotal),
      couponApplied,
      loyaltyApplied,
      ...(couponError ? { couponError } : {}),
      lines,
      hash,
    };
  }

  private releaseSessionReservations(session: CheckoutSessionRecord) {
    for (const item of session.items) {
      const current = this.stockReserved.get(item.productId) ?? 0;
      this.stockReserved.set(item.productId, Math.max(0, round2((current - item.quantity) * 10) / 10));
    }
  }

  private finalizeOrderStock(order: OrderRecord, session: CheckoutSessionRecord) {
    for (const item of session.items) {
      const reserved = this.stockReserved.get(item.productId) ?? 0;
      this.stockReserved.set(item.productId, Math.max(0, round2((reserved - item.quantity) * 10) / 10));
      const onHand = this.stockOnHand.get(item.productId) ?? 0;
      this.stockOnHand.set(item.productId, Math.max(0, round2((onHand - item.quantity) * 10) / 10));
      this.movements.unshift({
        id: crypto.randomUUID(),
        productId: item.productId,
        type: 'SALE',
        quantity: fmt3(-item.quantity),
        reason: `Order ${order.receiptNumber ?? order.id.slice(0, 8)}`,
        createdAt: new Date().toISOString(),
      });
    }
    session.status = 'COMPLETED';
    session.updatedAt = new Date().toISOString();
  }

  private scanIntoSession(session: CheckoutSessionRecord, barcode: string): BackendResponse {
    if (session.status !== 'OPEN') {
      return fail(409, 'Session is no longer open', 'SESSION_EXPIRED');
    }
    const product =
      this.productByBarcode.get(barcode.trim()) ??
      this.products.find((p) => p.sku.toLowerCase() === barcode.trim().toLowerCase());
    if (!product) {
      return fail(404, `Barcode ${barcode} not found`, 'PRODUCT_NOT_FOUND');
    }
    const step = product.weighed ? 0.5 : 1;
    if (this.availableOf(product.id) < step) {
      return fail(409, 'Out of stock', 'OUT_OF_STOCK');
    }
    this.stockReserved.set(product.id, (this.stockReserved.get(product.id) ?? 0) + step);
    let item = session.items.find((i) => i.productId === product.id);
    if (item) {
      item.quantity = round2((item.quantity + step) * 10) / 10;
    } else {
      item = { itemId: crypto.randomUUID(), productId: product.id, quantity: step };
      session.items.push(item);
    }
    session.updatedAt = new Date().toISOString();
    return {
      status: 200,
      body: {
        itemId: item.itemId,
        productId: product.id,
        name: product.name,
        quantity: fmt3(item.quantity),
        unit: product.unit,
        unitPrice: product.price,
        isWeighed: Boolean(product.weighed),
        barcode: product.barcode,
      },
    };
  }

  handle(req: BackendRequest): BackendResponse {
    const res = this.dispatch(req);
    const upper = req.method.toUpperCase();
    if (upper !== 'GET' && upper !== 'HEAD' && res.status >= 200 && res.status < 300) {
      this.persistToDisk();
    }
    return res;
  }

  private dispatch(req: BackendRequest): BackendResponse {
    const path = '/' + req.segments.join('/');
    const method = req.method.toUpperCase();
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;

    // ---- Health & Branches --------------------------------------------------
    if (method === 'GET' && path === '/health') {
      return {
        status: 200,
        body: {
          status: 'ok',
          service: SERVICE_NAME,
          description: this.storageFile
            ? 'QuickCart offline-persistent API (local disk store)'
            : 'QuickCart in-memory demo API (standalone mode)',
          persistence: this.storageFile ? 'disk' : 'memory',
          timestamp: new Date().toISOString(),
          uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
          checks: { database: 'up' },
        },
      };
    }

    if (method === 'GET' && path === '/branches') {
      return {
        status: 200,
        body: [{ id: DEMO_BRANCH.id, code: DEMO_BRANCH.code, name: DEMO_BRANCH.name, city: DEMO_BRANCH.city }],
      };
    }

    // ---- Auth & Users -------------------------------------------------------
    if (method === 'POST' && path === '/auth/login') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const user = this.usersByEmail.get(email);
      if (!user || password !== DEMO_PASSWORD) {
        return fail(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
      }
      const accessToken = `demo-at-${crypto.randomUUID()}`;
      const refreshToken = `demo-rt-${crypto.randomUUID()}`;
      this.accessTokens.set(accessToken, user.id);
      this.refreshTokens.set(refreshToken, user.id);
      this.lastLoginByUserId.set(user.id, new Date().toISOString());
      return {
        status: 200,
        setRefreshCookie: refreshToken,
        body: {
          accessToken,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            roles: user.roles,
            branchId: user.branchId,
          },
        },
      };
    }

    if (method === 'POST' && path === '/auth/refresh') {
      const rt = req.refreshCookie;
      const userId = rt ? this.refreshTokens.get(rt) : undefined;
      const user = userId ? this.usersById.get(userId) : undefined;
      if (!user || !rt) {
        return fail(401, 'No active session', 'NO_REFRESH_TOKEN');
      }
      this.refreshTokens.delete(rt);
      const nextRefresh = `demo-rt-${crypto.randomUUID()}`;
      const accessToken = `demo-at-${crypto.randomUUID()}`;
      this.refreshTokens.set(nextRefresh, user.id);
      this.accessTokens.set(accessToken, user.id);
      return {
        status: 200,
        setRefreshCookie: nextRefresh,
        body: {
          accessToken,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            roles: user.roles,
            branchId: user.branchId,
          },
        },
      };
    }

    if (method === 'POST' && path === '/auth/logout') {
      if (req.refreshCookie) this.refreshTokens.delete(req.refreshCookie);
      const auth = req.authorization;
      if (auth?.startsWith('Bearer ')) {
        this.accessTokens.delete(auth.slice('Bearer '.length).trim());
      }
      return { status: 204, body: null, setRefreshCookie: null };
    }

    if (method === 'GET' && path === '/users/me') {
      const staff = this.requireStaff(req);
      if ('status' in staff) return staff;
      return {
        status: 200,
        body: {
          id: staff.id,
          email: staff.email,
          fullName: staff.fullName,
          roles: staff.roles,
          branchId: staff.branchId,
          permissions: staff.permissions,
          branch: staff.branchId
            ? { id: DEMO_BRANCH.id, code: DEMO_BRANCH.code, name: DEMO_BRANCH.name }
            : null,
          lastLoginAt: this.lastLoginByUserId.get(staff.id) ?? null,
        },
      };
    }

    // ---- Catalogue ----------------------------------------------------------
    if (method === 'GET' && path === '/products') {
      const staff = this.requireStaff(req, 'catalogue:read');
      if ('status' in staff) return staff;
      const page = Math.max(1, Number(req.query.get('page') ?? 1) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.get('limit') ?? 10) || 10));
      const q = (req.query.get('q') ?? '').trim().toLowerCase();
      const filtered = q
        ? this.products.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.sku.toLowerCase().includes(q) ||
              p.barcode.includes(q) ||
              (p.brand?.toLowerCase().includes(q) ?? false),
          )
        : this.products;
      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const start = (page - 1) * limit;
      return {
        status: 200,
        body: {
          data: filtered.slice(start, start + limit).map((p) => this.serializeProduct(p)),
          meta: { page, limit, total, totalPages },
        },
      };
    }

    if (method === 'GET' && req.segments[0] === 'products' && req.segments[1] === 'barcode' && req.segments[2]) {
      const staff = this.requireStaff(req, 'catalogue:read');
      if ('status' in staff) return staff;
      const product = this.productByBarcode.get(req.segments[2]);
      if (!product) return fail(404, 'Product not found', 'PRODUCT_NOT_FOUND');
      return {
        status: 200,
        body: {
          ...this.serializeProduct(product),
          branch: {
            branchId: DEMO_BRANCH.id,
            isAvailable: true,
            priceOverride: null,
            availableStock: fmt3(this.availableOf(product.id)),
          },
        },
      };
    }

    // ---- Customer Self-Checkout & Shared Session Endpoints ------------------
    if (method === 'POST' && path === '/checkout/sessions') {
      const branchId = String(body.branchId ?? DEMO_BRANCH.id);
      const id = crypto.randomUUID();
      const token = crypto.randomBytes(24).toString('hex');
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 60_000).toISOString();
      this.sessions.set(id, {
        id,
        token,
        branchId,
        channel: 'SELF_CHECKOUT',
        status: 'OPEN',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt,
        customerId: null,
        items: [],
        lastCouponCode: null,
        lastLoyaltyPoints: 0,
      });
      return { status: 201, body: { sessionId: id, sessionToken: token, expiresAt } };
    }

    if (req.segments[0] === 'checkout' && req.segments[1] === 'sessions' && req.segments[2]) {
      const sessionId = req.segments[2];
      const session = this.authorizeSession(req, sessionId);
      if ('status' in session && !('items' in session)) return session;

      const sub = req.segments[3];
      const sub2 = req.segments[4];

      if (method === 'GET' && !sub) {
        return { status: 200, body: this.serializeSession(session) };
      }

      if (method === 'GET' && sub === 'search') {
        const q = (req.query.get('q') ?? '').trim().toLowerCase();
        const matches = this.products
          .filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.sku.toLowerCase().includes(q) ||
              p.barcode.includes(q),
          )
          .slice(0, 12)
          .map((p) => ({
            productId: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            unit: p.unit,
            isWeighed: Boolean(p.weighed),
            unitPrice: p.price,
            availableStock: fmt3(this.availableOf(p.id)),
          }));
        return { status: 200, body: matches };
      }

      if (method === 'POST' && sub === 'items' && sub2 === 'scan') {
        return this.scanIntoSession(session, String(body.barcode ?? ''));
      }

      if (method === 'PATCH' && sub === 'items' && sub2) {
        const item = session.items.find((i) => i.itemId === sub2);
        if (!item) return fail(404, 'Cart item not found', 'ITEM_NOT_FOUND');
        const nextQty = Number(body.quantity);
        if (!Number.isFinite(nextQty) || nextQty <= 0) {
          return fail(400, 'Invalid quantity', 'INVALID_QUANTITY');
        }
        const delta = nextQty - item.quantity;
        if (delta > 0 && this.availableOf(item.productId) < delta) {
          return fail(409, 'Out of stock', 'OUT_OF_STOCK');
        }
        this.stockReserved.set(
          item.productId,
          Math.max(0, round2(((this.stockReserved.get(item.productId) ?? 0) + delta) * 10) / 10),
        );
        item.quantity = round2(nextQty * 1000) / 1000;
        session.updatedAt = new Date().toISOString();
        return { status: 200, body: this.serializeSession(session) };
      }

      if (method === 'DELETE' && sub === 'items' && sub2) {
        const idx = session.items.findIndex((i) => i.itemId === sub2);
        if (idx === -1) return fail(404, 'Cart item not found', 'ITEM_NOT_FOUND');
        const [removed] = session.items.splice(idx, 1);
        if (removed) {
          const cur = this.stockReserved.get(removed.productId) ?? 0;
          this.stockReserved.set(
            removed.productId,
            Math.max(0, round2((cur - removed.quantity) * 10) / 10),
          );
        }
        session.updatedAt = new Date().toISOString();
        return { status: 200, body: this.serializeSession(session) };
      }

      if (method === 'POST' && sub === 'quote') {
        const couponCode = typeof body.couponCode === 'string' ? body.couponCode : undefined;
        const loyaltyPoints = typeof body.loyaltyPoints === 'number' ? body.loyaltyPoints : undefined;
        session.lastCouponCode = couponCode ?? null;
        session.lastLoyaltyPoints = loyaltyPoints ?? 0;
        return {
          status: 200,
          body: { quote: this.computeQuote(session, couponCode, loyaltyPoints) },
        };
      }

      if (method === 'POST' && sub === 'customer') {
        const phone = String(body.phone ?? '').trim();
        let customer = this.customers.get(phone);
        if (!customer) {
          customer = {
            id: `cust-${crypto.randomUUID().slice(0, 8)}`,
            name: `Shopper ${phone.slice(-4)}`,
            phone,
            email: null,
            loyaltyPoints: 50,
          };
          this.customers.set(phone, customer);
        }
        session.customerId = customer.id;
        return {
          status: 200,
          body: {
            customerId: customer.id,
            name: customer.name,
            loyaltyPoints: customer.loyaltyPoints,
          },
        };
      }

      if (method === 'POST' && sub === 'confirm') {
        if (session.items.length === 0) return fail(400, 'Cart is empty', 'EMPTY_CART');
        const idempotencyKey = String(body.idempotencyKey ?? crypto.randomUUID());
        const existing = this.orderByIdempotency.get(idempotencyKey);
        if (existing) {
          return {
            status: 200,
            body: { orderId: existing.id, status: existing.status, sessionId: session.id, retry: true },
          };
        }
        const quote = this.computeQuote(
          session,
          session.lastCouponCode ?? undefined,
          session.lastLoyaltyPoints || undefined,
        );
        if (body.expectedQuoteHash && body.expectedQuoteHash !== quote.hash) {
          return fail(409, 'Cart changed since last quote', 'CART_STALE');
        }
        const orderId = crypto.randomUUID();
        const order: OrderRecord = {
          id: orderId,
          sessionId: session.id,
          channel: session.channel,
          status: 'PENDING_PAYMENT',
          placedAt: new Date().toISOString(),
          receiptNumber: null,
          provider: 'MOCK',
          subtotal: Number(quote.subtotal),
          itemDiscountTotal: Number(quote.itemDiscountTotal),
          couponDiscountTotal: Number(quote.couponDiscountTotal),
          taxTotal: Number(quote.taxTotal),
          grandTotal: Number(quote.grandTotal),
          lines: quote.lines.map((l) => {
            const p = this.productById.get(l.productId)!;
            return {
              productId: p.id,
              name: p.name,
              sku: p.sku,
              unit: p.unit,
              quantity: Number(l.quantity),
              unitPrice: Number(l.unitPrice),
              lineSubtotal: Number(l.lineSubtotal),
              lineTaxTotal: Number(l.lineTaxTotal),
              lineTotal: Number(l.lineTotal),
              taxableValue: Number(l.taxableValue),
              taxLines: l.taxLines,
            };
          }),
          idempotencyKey,
        };
        this.orders.set(orderId, order);
        this.orderByIdempotency.set(idempotencyKey, order);
        return {
          status: 201,
          body: { orderId: order.id, status: order.status, sessionId: session.id },
        };
      }

      if (method === 'POST' && sub === 'cancel') {
        if (session.status === 'OPEN' || session.status === 'SUSPENDED') {
          this.releaseSessionReservations(session);
          session.status = 'CANCELLED';
          session.updatedAt = new Date().toISOString();
        }
        return { status: 200, body: { sessionId: session.id, status: session.status } };
      }
    }

    // ---- Payments & Receipts ------------------------------------------------
    if (method === 'POST' && path === '/payments/intent') {
      const orderId = String(body.orderId ?? '');
      const order = this.orders.get(orderId);
      if (!order) return fail(404, 'Order not found', 'ORDER_NOT_FOUND');
      const paymentId = crypto.randomUUID();
      const payment: PaymentRecord = {
        id: paymentId,
        orderId: order.id,
        provider: 'MOCK',
        providerRef: `mock_${paymentId.slice(0, 12)}`,
        status: 'PENDING',
        idempotencyKey: String(body.idempotencyKey ?? crypto.randomUUID()),
      };
      this.payments.set(paymentId, payment);
      return {
        status: 201,
        body: {
          paymentId: payment.id,
          provider: payment.provider,
          providerRef: payment.providerRef,
          status: payment.status,
          orderId: payment.orderId,
        },
      };
    }

    if (method === 'POST' && req.segments[0] === 'payments' && req.segments[1] && req.segments[2] === 'mock-settle') {
      const payment = this.payments.get(req.segments[1]);
      if (!payment) return fail(404, 'Payment not found', 'PAYMENT_NOT_FOUND');
      const order = this.orders.get(payment.orderId);
      if (!order) return fail(404, 'Order not found', 'ORDER_NOT_FOUND');
      if (payment.status !== 'SETTLED') {
        payment.status = 'SETTLED';
        order.status = 'COMPLETED';
        order.receiptNumber = `QM-PAN-${this.receiptCounter++}`;
        const session = this.sessions.get(order.sessionId);
        if (session) this.finalizeOrderStock(order, session);
      }
      return {
        status: 200,
        body: { settled: true, receiptNumber: order.receiptNumber ?? undefined },
      };
    }

    if (method === 'GET' && req.segments[0] === 'orders' && req.segments[1] && req.segments[2] === 'receipt') {
      const order = this.orders.get(req.segments[1]);
      if (!order || !order.receiptNumber) return fail(404, 'Receipt not found', 'RECEIPT_NOT_FOUND');
      return {
        status: 200,
        body: {
          invoiceNumber: order.receiptNumber,
          issuedAt: order.placedAt,
          payload: {
            store: {
              name: DEMO_BRANCH.name,
              code: DEMO_BRANCH.code,
              gstin: DEMO_BRANCH.gstin,
              city: DEMO_BRANCH.city,
              address: DEMO_BRANCH.address,
            },
            lines: order.lines.map((l) => ({
              name: l.name,
              quantity: fmt3(l.quantity),
              unit: l.unit,
              unitPrice: fmt2(l.unitPrice),
              lineTotal: fmt2(l.lineTotal),
              lineTaxTotal: fmt2(l.lineTaxTotal),
              taxableValue: fmt2(l.taxableValue),
              taxLines: l.taxLines.map((t) => ({ name: t.name, amount: t.amount, rate: t.rate })),
            })),
            totals: {
              subtotal: fmt2(order.subtotal),
              itemDiscountTotal: fmt2(order.itemDiscountTotal),
              couponDiscountTotal: fmt2(order.couponDiscountTotal),
              taxTotal: fmt2(order.taxTotal),
              grandTotal: fmt2(order.grandTotal),
            },
            payment: {
              provider: order.provider,
              amount: fmt2(order.grandTotal),
              currency: 'INR',
            },
          },
        },
      };
    }

    // ---- Staff POS Register -------------------------------------------------
    if (req.segments[0] === 'pos') {
      const staff = this.requireStaff(req, 'pos:operate');
      if ('status' in staff) return staff;

      if (method === 'POST' && path === '/pos/sessions') {
        const id = crypto.randomUUID();
        const now = new Date();
        this.sessions.set(id, {
          id,
          token: crypto.randomBytes(24).toString('hex'),
          branchId: DEMO_BRANCH.id,
          channel: 'POS',
          status: 'OPEN',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 120 * 60_000).toISOString(),
          customerId: null,
          items: [],
          lastCouponCode: null,
          lastLoyaltyPoints: 0,
        });
        return { status: 201, body: { sessionId: id, branchId: DEMO_BRANCH.id } };
      }

      if (method === 'GET' && path === '/pos/sessions') {
        const parked = [...this.sessions.values()]
          .filter((s) => s.channel === 'POS' && (s.status === 'OPEN' || s.status === 'SUSPENDED'))
          .map((s) => ({ id: s.id, status: s.status, updatedAt: s.updatedAt }));
        return { status: 200, body: parked };
      }

      if (req.segments[1] === 'sessions' && req.segments[2]) {
        const session = this.sessions.get(req.segments[2]);
        if (!session) return fail(404, 'POS session not found', 'SESSION_NOT_FOUND');

        if (method === 'POST' && req.segments[3] === 'items' && req.segments[4] === 'scan') {
          return this.scanIntoSession(session, String(body.barcode ?? ''));
        }

        if (method === 'POST' && req.segments[3] === 'suspend') {
          session.status = 'SUSPENDED';
          session.updatedAt = new Date().toISOString();
          return { status: 200, body: { id: session.id, status: session.status } };
        }

        if (method === 'POST' && req.segments[3] === 'resume') {
          session.status = 'OPEN';
          session.updatedAt = new Date().toISOString();
          return { status: 200, body: this.serializeSession(session) };
        }

        if (method === 'POST' && req.segments[3] === 'complete') {
          if (session.items.length === 0) return fail(400, 'Cart is empty', 'EMPTY_CART');
          const idempotencyKey = String(body.idempotencyKey ?? crypto.randomUUID());
          const existing = this.orderByIdempotency.get(idempotencyKey);
          if (existing) {
            return {
              status: 200,
              body: {
                orderId: existing.id,
                status: existing.status,
                receiptNumber: existing.receiptNumber ?? undefined,
                retry: true,
              },
            };
          }
          const quote = this.computeQuote(session);
          const paymentMethod = body.paymentMethod === 'CASH' ? 'CASH' : 'MOCK';
          const orderId = crypto.randomUUID();
          const receiptNumber = `QM-PAN-${this.receiptCounter++}`;
          const order: OrderRecord = {
            id: orderId,
            sessionId: session.id,
            channel: 'POS',
            status: 'COMPLETED',
            placedAt: new Date().toISOString(),
            receiptNumber,
            provider: paymentMethod,
            subtotal: Number(quote.subtotal),
            itemDiscountTotal: 0,
            couponDiscountTotal: 0,
            taxTotal: Number(quote.taxTotal),
            grandTotal: Number(quote.grandTotal),
            lines: quote.lines.map((l) => {
              const p = this.productById.get(l.productId)!;
              return {
                productId: p.id,
                name: p.name,
                sku: p.sku,
                unit: p.unit,
                quantity: Number(l.quantity),
                unitPrice: Number(l.unitPrice),
                lineSubtotal: Number(l.lineSubtotal),
                lineTaxTotal: Number(l.lineTaxTotal),
                lineTotal: Number(l.lineTotal),
                taxableValue: Number(l.taxableValue),
                taxLines: l.taxLines,
              };
            }),
            idempotencyKey,
          };
          this.orders.set(orderId, order);
          this.orderByIdempotency.set(idempotencyKey, order);
          this.finalizeOrderStock(order, session);
          if (!this.currentShift.closed) {
            this.currentShift.orders += 1;
            if (paymentMethod === 'CASH') {
              this.currentShift.cashOrders += 1;
              this.currentShift.cashCollected = round2(this.currentShift.cashCollected + order.grandTotal);
            } else {
              this.currentShift.cardOrders += 1;
              this.currentShift.cardCollected = round2(this.currentShift.cardCollected + order.grandTotal);
            }
          }
          return {
            status: 201,
            body: { orderId: order.id, status: order.status, receiptNumber },
          };
        }
      }

      if (method === 'GET' && path === '/pos/shifts/current') {
        if (this.currentShift.closed) return { status: 200, body: { shift: null } };
        return {
          status: 200,
          body: {
            shift: {
              id: this.currentShift.id,
              openedAt: this.currentShift.openedAt,
              openingCash: fmt2(this.currentShift.openingCash),
              orders: this.currentShift.orders,
              cashOrders: this.currentShift.cashOrders,
              cashCollected: fmt2(this.currentShift.cashCollected),
              cardOrders: this.currentShift.cardOrders,
              cardCollected: fmt2(this.currentShift.cardCollected),
              expectedDrawer: fmt2(this.currentShift.openingCash + this.currentShift.cashCollected),
            },
          },
        };
      }

      if (method === 'GET' && path === '/pos/shifts/history') {
        return { status: 200, body: this.shiftHistory };
      }

      if (method === 'POST' && path === '/pos/shifts') {
        const parsedOpening = Number(body.openingCash ?? 2000);
        const openingCash = Number.isFinite(parsedOpening) && parsedOpening >= 0 ? round2(parsedOpening) : 2000;
        this.currentShift = {
          id: `shift-${crypto.randomUUID().slice(0, 8)}`,
          openedAt: new Date().toISOString(),
          openingCash,
          orders: 0,
          cashOrders: 0,
          cashCollected: 0,
          cardOrders: 0,
          cardCollected: 0,
          closed: false,
        };
        return { status: 201, body: { shiftId: this.currentShift.id } };
      }

      if (method === 'POST' && path === '/pos/shifts/close') {
        if (this.currentShift.closed) {
          return fail(409, 'Shift is already closed', 'SHIFT_ALREADY_CLOSED');
        }
        const expected = round2(this.currentShift.openingCash + this.currentShift.cashCollected);
        const rawCounted = body.closingCash ?? body.countedCash;
        const parsedCounted =
          rawCounted !== undefined && rawCounted !== '' ? Number(rawCounted) : expected;
        if (!Number.isFinite(parsedCounted) || parsedCounted < 0) {
          return fail(400, 'Counted cash must be a non-negative number', 'INVALID_CLOSING_CASH');
        }
        const counted = round2(parsedCounted);
        const variance = round2(counted - expected);
        const gross = round2(this.currentShift.cashCollected + this.currentShift.cardCollected);
        const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim().slice(0, 200) : null;
        const zReport: ShiftZReportRecord = {
          reportNumber: `Z-PAN-${String(this.zReportCounter++).padStart(4, '0')}`,
          shiftId: this.currentShift.id,
          openedAt: this.currentShift.openedAt,
          closedAt: new Date().toISOString(),
          closedBy: staff.fullName,
          orders: this.currentShift.orders,
          cashOrders: this.currentShift.cashOrders,
          cardOrders: this.currentShift.cardOrders,
          openingCash: fmt2(this.currentShift.openingCash),
          cashCollected: fmt2(this.currentShift.cashCollected),
          cardCollected: fmt2(this.currentShift.cardCollected),
          grossSales: fmt2(gross),
          expectedDrawer: fmt2(expected),
          countedCash: fmt2(counted),
          variance: `${variance >= 0 ? '+' : '-'}${fmt2(Math.abs(variance))}`,
          notes,
        };
        this.currentShift.closed = true;
        this.shiftHistory.unshift(zReport);
        return { status: 200, body: { closed: true, zReport } };
      }

      if (method === 'GET' && path === '/pos/refunds') {
        const list = [...this.refunds.values()].filter((r) => r.status === 'PENDING_APPROVAL');
        return { status: 200, body: list };
      }

      if (method === 'POST' && path === '/pos/refunds') {
        const orderId = String(body.orderId ?? '');
        const order = this.orders.get(orderId);
        if (!order) return fail(404, 'Order not found', 'ORDER_NOT_FOUND');
        const refundId = crypto.randomUUID();
        const record: RefundRecord = {
          refundId,
          orderId: order.id,
          amount: fmt2(order.grandTotal),
          currency: 'INR',
          reason: String(body.reason ?? 'Register refund'),
          status: 'PENDING_APPROVAL',
          requestedAt: new Date().toISOString(),
        };
        this.refunds.set(refundId, record);
        return { status: 201, body: { refundId, status: record.status } };
      }

      if (method === 'POST' && req.segments[1] === 'refunds' && req.segments[2] && req.segments[3] === 'approve') {
        if (!staff.permissions.includes('orders:refund:approve')) {
          return fail(403, 'Manager approval required', 'FORBIDDEN');
        }
        const refund = this.refunds.get(req.segments[2]);
        if (!refund) return fail(404, 'Refund not found', 'REFUND_NOT_FOUND');
        if (refund.status !== 'APPROVED') {
          refund.status = 'APPROVED';
          const order = this.orders.get(refund.orderId);
          if (order) {
            order.status = 'REFUNDED';
            for (const line of order.lines) {
              const cur = this.stockOnHand.get(line.productId) ?? 0;
              this.stockOnHand.set(line.productId, round2((cur + line.quantity) * 10) / 10);
            }
          }
        }
        return { status: 200, body: { refundId: refund.refundId, status: refund.status } };
      }
    }

    // ---- Inventory ----------------------------------------------------------
    if (req.segments[0] === 'inventory') {
      const staff = this.requireStaff(req, 'inventory:read');
      if ('status' in staff) return staff;

      if (method === 'GET' && path === '/inventory') {
        const rows = this.products.map((p) => {
          const onHand = this.stockOnHand.get(p.id) ?? 0;
          const reserved = this.stockReserved.get(p.id) ?? 0;
          const available = this.availableOf(p.id);
          return {
            productId: p.id,
            name: p.name,
            sku: p.sku,
            unit: p.unit,
            onHand: fmt3(onHand),
            reserved: fmt3(reserved),
            available: fmt3(available),
            lowStockThreshold: fmt3(p.threshold),
            isLowStock: available < p.threshold,
          };
        });
        return { status: 200, body: rows };
      }

      if (method === 'GET' && path === '/inventory/alerts') {
        const lowStock = this.products
          .map((p) => {
            const available = this.availableOf(p.id);
            return { p, available };
          })
          .filter(({ p, available }) => available < p.threshold)
          .map(({ p, available }) => ({
            productId: p.id,
            name: p.name,
            sku: p.sku,
            available: fmt3(available),
            threshold: fmt3(p.threshold),
            suggestedReorder: fmt3(Math.max(p.threshold * 2 - available, p.threshold)),
          }));

        const cutoff = Date.now() + 7 * 86_400_000;
        const nearExpiry = this.batches
          .filter((b) => new Date(b.expiryDate).getTime() <= cutoff && b.quantity > 0)
          .map((b) => ({
            batchId: b.batchId,
            productId: b.productId,
            name: b.name,
            batchNumber: b.batchNumber,
            expiryDate: b.expiryDate,
            quantity: fmt3(b.quantity),
          }));

        return { status: 200, body: { lowStock, nearExpiry } };
      }

      if (method === 'GET' && path === '/inventory/movements') {
        const page = Math.max(1, Number(req.query.get('page') ?? 1) || 1);
        const limit = Math.min(50, Math.max(1, Number(req.query.get('limit') ?? 15) || 15));
        const total = this.movements.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const slice = this.movements.slice((page - 1) * limit, page * limit).map((m) => {
          const p = this.productById.get(m.productId);
          return {
            id: m.id,
            type: m.type,
            quantity: m.quantity,
            reason: m.reason,
            product: { name: p?.name ?? 'Unknown', sku: p?.sku ?? '' },
            createdAt: m.createdAt,
          };
        });
        return { status: 200, body: { data: slice, meta: { total, page, totalPages } } };
      }

      if (method === 'POST' && path === '/inventory/adjustments') {
        if (!staff.permissions.includes('inventory:adjust')) {
          return fail(403, 'Forbidden', 'FORBIDDEN');
        }
        const productId = String(body.productId ?? '');
        const delta = Number(body.quantityDelta);
        const reason = String(body.reason ?? '').trim();
        if (!this.productById.has(productId) || !Number.isFinite(delta) || reason.length < 3) {
          return fail(400, 'Invalid adjustment request', 'VALIDATION_ERROR');
        }
        const current = this.stockOnHand.get(productId) ?? 0;
        const next = Math.max(0, round2((current + delta) * 1000) / 1000);
        this.stockOnHand.set(productId, next);
        this.movements.unshift({
          id: crypto.randomUUID(),
          productId,
          type: 'MANUAL_ADJUSTMENT',
          quantity: fmt3(delta),
          reason,
          createdAt: new Date().toISOString(),
        });
        return { status: 201, body: { productId, onHand: fmt3(next) } };
      }

      if (method === 'POST' && path === '/inventory/receipts') {
        if (!staff.permissions.includes('inventory:receive')) {
          return fail(403, 'Forbidden', 'FORBIDDEN');
        }
        const lines = Array.isArray(body.lines) ? (body.lines as Array<Record<string, unknown>>) : [];
        if (lines.length === 0) return fail(400, 'At least one receipt line required');
        const receiptNumber = `GR-2026-${String(this.goodsReceiptCounter++).padStart(4, '0')}`;
        for (const line of lines) {
          const productId = String(line.productId ?? '');
          const product = this.productById.get(productId);
          const qty = Number(line.quantity);
          if (!product || !Number.isFinite(qty) || qty <= 0) continue;
          this.stockOnHand.set(productId, (this.stockOnHand.get(productId) ?? 0) + qty);
          if (line.expiryDate) {
            this.batches.push({
              batchId: crypto.randomUUID(),
              productId,
              sku: product.sku,
              name: product.name,
              batchNumber: String(line.batchNumber ?? 'BATCH'),
              expiryDate: new Date(String(line.expiryDate)).toISOString(),
              quantity: qty,
            });
          }
          this.movements.unshift({
            id: crypto.randomUUID(),
            productId,
            type: 'PURCHASE_RECEIPT',
            quantity: fmt3(qty),
            reason: `Goods receipt ${receiptNumber}`,
            createdAt: new Date().toISOString(),
          });
        }
        return { status: 201, body: { receiptNumber } };
      }

      if (method === 'GET' && path === '/inventory/counts') {
        return { status: 200, body: this.counts };
      }

      if (method === 'POST' && path === '/inventory/counts') {
        if (!staff.permissions.includes('inventory:adjust')) {
          return fail(403, 'Forbidden', 'FORBIDDEN');
        }
        const record: CountRecord = {
          countId: crypto.randomUUID(),
          countNumber: `SC-2026-${String(this.countCounter++).padStart(4, '0')}`,
          status: 'PENDING_APPROVAL',
          lines: this.products.length,
          startedAt: new Date().toISOString(),
        };
        this.counts.unshift(record);
        return {
          status: 201,
          body: { countId: record.countId, countNumber: record.countNumber, lines: record.lines },
        };
      }

      if (method === 'POST' && req.segments[1] === 'counts' && req.segments[2] && req.segments[3] === 'approve') {
        if (!staff.permissions.includes('inventory:adjust:approve')) {
          return fail(403, 'Forbidden', 'FORBIDDEN');
        }
        const found = this.counts.find((c) => c.countId === req.segments[2]);
        if (!found) return fail(404, 'Count not found');
        found.status = 'APPROVED';
        return { status: 200, body: { status: found.status, adjustmentsPosted: 0 } };
      }
    }

    // ---- Dashboard Analytics ------------------------------------------------
    if (req.segments[0] === 'dashboard') {
      const staff = this.requireStaff(req);
      if ('status' in staff) return staff;
      if (!staff.permissions.some((p) => p.startsWith('dashboard:view'))) {
        return fail(403, 'Forbidden', 'FORBIDDEN');
      }

      const completedOrders = [...this.orders.values()].filter((o) => o.status === 'COMPLETED');

      if (method === 'GET' && path === '/dashboard/recent-orders') {
        const list = [...this.orders.values()]
          .sort((a, b) => b.placedAt.localeCompare(a.placedAt))
          .slice(0, 20)
          .map((o) => ({
            orderId: o.id,
            channel: o.channel,
            status: o.status,
            grandTotal: fmt2(o.grandTotal),
            receiptNumber: o.receiptNumber,
            placedAt: o.placedAt,
          }));
        return { status: 200, body: list };
      }

      if (method === 'GET' && path === '/dashboard/summary') {
        const gross = completedOrders.reduce((sum, o) => sum + o.grandTotal, 0);
        const avg = completedOrders.length > 0 ? gross / completedOrders.length : 0;
        const mixMap = new Map<string, { orders: number; total: number }>();
        for (const o of completedOrders) {
          const entry = mixMap.get(o.provider) ?? { orders: 0, total: 0 };
          entry.orders += 1;
          entry.total = round2(entry.total + o.grandTotal);
          mixMap.set(o.provider, entry);
        }
        return {
          status: 200,
          body: {
            orders: completedOrders.length,
            grossSales: fmt2(gross),
            averageBasket: fmt2(avg),
            paymentMix: [...mixMap.entries()].map(([provider, v]) => ({
              provider,
              orders: v.orders,
              total: fmt2(v.total),
            })),
          },
        };
      }

      if (method === 'GET' && path === '/dashboard/sales') {
        const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, total: 0 }));
        for (const o of completedOrders) {
          const hour = new Date(o.placedAt).getHours();
          buckets[hour]!.orders += 1;
          buckets[hour]!.total = round2(buckets[hour]!.total + o.grandTotal);
        }
        return {
          status: 200,
          body: buckets.map((b) => ({ hour: b.hour, orders: b.orders, total: fmt2(b.total) })),
        };
      }

      if (method === 'GET' && path === '/dashboard/top-products') {
        const totals = new Map<string, { productId: string; name: string; sku: string; units: number; revenue: number }>();
        for (const o of completedOrders) {
          for (const line of o.lines) {
            const entry = totals.get(line.productId) ?? {
              productId: line.productId,
              name: line.name,
              sku: line.sku,
              units: 0,
              revenue: 0,
            };
            entry.units += line.quantity;
            entry.revenue = round2(entry.revenue + line.lineTotal);
            totals.set(line.productId, entry);
          }
        }
        const ranked = [...totals.values()]
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 10)
          .map((item) => ({
            productId: item.productId,
            name: item.name,
            sku: item.sku,
            unitsSold: fmt3(item.units),
            revenue: fmt2(item.revenue),
          }));
        return { status: 200, body: ranked };
      }
    }

    return fail(404, `Route not found: ${method} ${path}`, 'NOT_FOUND');
  }
}

const globalForDemo = globalThis as unknown as { __quickcartDemoBackend?: DemoBackend };

export function getDemoBackend(): DemoBackend {
  globalForDemo.__quickcartDemoBackend ??= new DemoBackend();
  return globalForDemo.__quickcartDemoBackend;
}
