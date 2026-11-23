import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DemoBackend, type ShiftZReportRecord } from './demo-backend';
import { formatZReportText } from './desktop-receipt';

function call(
  backend: DemoBackend,
  method: string,
  urlPath: string,
  options: { body?: unknown; auth?: string } = {},
) {
  const [pathname = '', queryString = ''] = urlPath.split('?');
  const segments = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  return backend.handle({
    method,
    segments,
    query: new URLSearchParams(queryString),
    body: options.body ?? null,
    authorization: options.auth ? `Bearer ${options.auth}` : null,
    sessionToken: null,
    refreshCookie: null,
  });
}

test('DemoBackend persists sales, stock decrements, and Shift Close Z-Report across restarts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickcart-persist-'));
  try {
    // 1. First app run: login as cashier, sell 1 Amul Toned Milk (₹27.00 CASH), close shift with ₹2025.00 (-₹2.00 short)
    const run1 = new DemoBackend(tempDir);
    const health = call(run1, 'GET', '/health');
    assert.equal(health.status, 200);
    assert.equal((health.body as { persistence: string }).persistence, 'disk');

    const login = call(run1, 'POST', '/auth/login', {
      body: { email: 'cashier@quickmart.dev', password: 'QuickMart!dev123' },
    });
    assert.equal(login.status, 200);
    const token1 = (login.body as { accessToken: string }).accessToken;

    const session = call(run1, 'POST', '/pos/sessions', { auth: token1 });
    const sessionId = (session.body as { sessionId: string }).sessionId;

    const scan = call(run1, 'POST', `/pos/sessions/${sessionId}/items/scan`, {
      auth: token1,
      body: { barcode: '8900100000424' }, // Amul Toned Milk 500ml, ₹27.00, 0% GST, initial stock 6
    });
    assert.equal(scan.status, 200);

    const complete = call(run1, 'POST', `/pos/sessions/${sessionId}/complete`, {
      auth: token1,
      body: { paymentMethod: 'CASH', idempotencyKey: 'persist-sale-1' },
    });
    assert.equal(complete.status, 201);

    const closeRes = call(run1, 'POST', '/pos/shifts/close', {
      auth: token1,
      body: { closingCash: '2025.00', notes: 'Evening counter close' },
    });
    assert.equal(closeRes.status, 200);
    const { zReport } = closeRes.body as { closed: boolean; zReport: ShiftZReportRecord };
    assert.equal(zReport.reportNumber, 'Z-PAN-0001');
    assert.equal(zReport.expectedDrawer, '2027.00');
    assert.equal(zReport.countedCash, '2025.00');
    assert.equal(zReport.variance, '-2.00');

    const zText = formatZReportText(zReport, 42);
    assert.match(zText, /Z-PAN-0001/);
    assert.match(zText, /INR -2\.00/);

    // 2. Second app run (simulating closing & reopening QuickCart.exe): rehydrates from same tempDir
    const run2 = new DemoBackend(tempDir);
    const login2 = call(run2, 'POST', '/auth/login', {
      body: { email: 'admin@quickmart.dev', password: 'QuickMart!dev123' },
    });
    const token2 = (login2.body as { accessToken: string }).accessToken;

    // Shift stays closed and Z-Report history survives restart
    const shiftAfter = call(run2, 'GET', '/pos/shifts/current', { auth: token2 });
    assert.equal((shiftAfter.body as { shift: unknown }).shift, null);

    const historyAfter = call(run2, 'GET', '/pos/shifts/history', { auth: token2 });
    const reports = historyAfter.body as ShiftZReportRecord[];
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.reportNumber, 'Z-PAN-0001');

    // Inventory decrement (6 -> 5) survives restart
    const balances = call(run2, 'GET', '/inventory', { auth: token2 });
    const milk = (balances.body as Array<{ sku: string; onHand: string }>).find(
      (row) => row.sku === 'QM-DA-001',
    );
    assert.equal(milk?.onHand, '5.000');

    // Reopening a fresh shift persists cleanly too
    const reopen = call(run2, 'POST', '/pos/shifts', {
      auth: token2,
      body: { openingCash: '1500.00' },
    });
    assert.equal(reopen.status, 201);
    const run3 = new DemoBackend(tempDir);
    const login3 = call(run3, 'POST', '/auth/login', {
      body: { email: 'admin@quickmart.dev', password: 'QuickMart!dev123' },
    });
    const token3 = (login3.body as { accessToken: string }).accessToken;
    const shift3 = call(run3, 'GET', '/pos/shifts/current', { auth: token3 });
    assert.equal(
      (shift3.body as { shift: { openingCash: string } }).shift.openingCash,
      '1500.00',
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
