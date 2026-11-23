import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoBackend } from './demo-backend';
import { DEMO_PASSWORD } from './demo-seed';

function call(
  backend: DemoBackend,
  method: string,
  path: string,
  options?: {
    body?: unknown;
    authorization?: string;
    sessionToken?: string;
    refreshCookie?: string;
  },
) {
  const [pathname = '', qs] = path.split('?');
  const segments = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  return backend.handle({
    method,
    segments,
    query: new URLSearchParams(qs ?? ''),
    body: options?.body ?? null,
    authorization: options?.authorization ?? null,
    sessionToken: options?.sessionToken ?? null,
    refreshCookie: options?.refreshCookie ?? null,
  });
}

test('health and branches endpoints return seeded QuickMart Panaji store', () => {
  const backend = new DemoBackend();
  const health = call(backend, 'GET', '/health');
  assert.equal(health.status, 200);
  const hBody = health.body as { status: string; checks: { database: string } };
  assert.equal(hBody.status, 'ok');
  assert.equal(hBody.checks.database, 'up');

  const branches = call(backend, 'GET', '/branches');
  assert.equal(branches.status, 200);
  const bBody = branches.body as Array<{ code: string; name: string }>;
  assert.equal(bBody.length, 1);
  assert.equal(bBody[0]?.code, 'QM-PAN');
});

test('self-checkout flow scans seeded barcodes, calculates GST, settles payment, and issues receipt', () => {
  const backend = new DemoBackend();
  const created = call(backend, 'POST', '/checkout/sessions', {
    body: { branchId: 'branch-qm-pan' },
  });
  assert.equal(created.status, 201);
  const { sessionId, sessionToken } = created.body as {
    sessionId: string;
    sessionToken: string;
  };

  // Scan 2x Amul Toned Milk 500ml (₹27.00, 0% GST) + 1x Britannia White Bread (₹45.00, 5% GST)
  assert.equal(
    call(backend, 'POST', `/checkout/sessions/${sessionId}/items/scan`, {
      sessionToken,
      body: { barcode: '8900100000424' },
    }).status,
    200,
  );
  assert.equal(
    call(backend, 'POST', `/checkout/sessions/${sessionId}/items/scan`, {
      sessionToken,
      body: { barcode: '8900100000424' },
    }).status,
    200,
  );
  assert.equal(
    call(backend, 'POST', `/checkout/sessions/${sessionId}/items/scan`, {
      sessionToken,
      body: { barcode: '8900100000844' },
    }).status,
    200,
  );

  const quoteRes = call(backend, 'POST', `/checkout/sessions/${sessionId}/quote`, {
    sessionToken,
    body: {},
  });
  assert.equal(quoteRes.status, 200);
  const { quote } = quoteRes.body as {
    quote: { subtotal: string; taxTotal: string; grandTotal: string; hash: string };
  };
  assert.equal(quote.subtotal, '99.00');
  assert.equal(quote.taxTotal, '2.25');
  assert.equal(quote.grandTotal, '101.25');

  const confirm = call(backend, 'POST', `/checkout/sessions/${sessionId}/confirm`, {
    sessionToken,
    body: { idempotencyKey: 'idem-1', expectedQuoteHash: quote.hash },
  });
  assert.equal(confirm.status, 201);
  const { orderId } = confirm.body as { orderId: string };

  const intent = call(backend, 'POST', '/payments/intent', {
    sessionToken,
    body: { orderId, idempotencyKey: 'pay-1' },
  });
  assert.equal(intent.status, 201);
  const { paymentId } = intent.body as { paymentId: string };

  const settle = call(backend, 'POST', `/payments/${paymentId}/mock-settle`, { sessionToken });
  assert.equal(settle.status, 200);
  const receipt = call(backend, 'GET', `/orders/${orderId}/receipt`, { sessionToken });
  assert.equal(receipt.status, 200);
  const rBody = receipt.body as { invoiceNumber: string; payload: { totals: { grandTotal: string } } };
  assert.ok(rBody.invoiceNumber.startsWith('QM-PAN-'));
  assert.equal(rBody.payload.totals.grandTotal, '101.25');
});

test('staff login, cookie refresh, POS sale, inventory adjustment, and dashboard metrics work end-to-end', () => {
  const backend = new DemoBackend();

  const badLogin = call(backend, 'POST', '/auth/login', {
    body: { email: 'admin@quickmart.dev', password: 'wrong' },
  });
  assert.equal(badLogin.status, 401);

  const login = call(backend, 'POST', '/auth/login', {
    body: { email: 'admin@quickmart.dev', password: DEMO_PASSWORD },
  });
  assert.equal(login.status, 200);
  assert.ok(login.setRefreshCookie);
  const { accessToken } = login.body as { accessToken: string };
  const auth = `Bearer ${accessToken}`;

  const refresh = call(backend, 'POST', '/auth/refresh', {
    refreshCookie: login.setRefreshCookie ?? undefined,
  });
  assert.equal(refresh.status, 200);

  const products = call(backend, 'GET', '/products?page=1&limit=10&q=amul', {
    authorization: auth,
  });
  assert.equal(products.status, 200);
  const pBody = products.body as { meta: { total: number } };
  assert.equal(pBody.meta.total, 4);

  const posSession = call(backend, 'POST', '/pos/sessions', { authorization: auth });
  assert.equal(posSession.status, 201);
  const { sessionId } = posSession.body as { sessionId: string };

  assert.equal(
    call(backend, 'POST', `/pos/sessions/${sessionId}/items/scan`, {
      authorization: auth,
      body: { barcode: '8900100001964' },
    }).status,
    200,
  );
  const completed = call(backend, 'POST', `/pos/sessions/${sessionId}/complete`, {
    authorization: auth,
    body: { paymentMethod: 'CASH', idempotencyKey: 'pos-1' },
  });
  assert.equal(completed.status, 201);

  const summary = call(backend, 'GET', '/dashboard/summary', { authorization: auth });
  assert.equal(summary.status, 200);
  const sBody = summary.body as { orders: number; grossSales: string };
  assert.equal(sBody.orders, 1);
  assert.equal(sBody.grossSales, '11.80');
});
