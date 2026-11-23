import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThermalReceiptHtml } from './receipt-html';

test('buildThermalReceiptHtml formats 80mm thermal slip with totals and cash tender', () => {
  const html = buildThermalReceiptHtml({
    invoiceNumber: 'QM-PAN-1001',
    issuedAt: '10:52 AM',
    storeName: 'QuickMart Panaji',
    storeAddress: '18 June Road, Panaji',
    gstin: '30ABCDE1234F1Z5',
    lines: [
      { name: 'Amul Toned Milk 500ml', quantity: '1', unitPrice: '27.00', lineTotal: '27.00' },
      { name: 'Britannia White Bread 400g', quantity: '1', unitPrice: '45.00', lineTotal: '45.00' },
    ],
    subtotal: '72.00',
    taxTotal: '2.25',
    grandTotal: '74.25',
    paymentMethod: 'CASH',
    tendered: '100.00',
    changeDue: '25.75',
  });

  assert.match(html, /@page \{ size: 80mm auto; margin: 0; \}/);
  assert.match(html, /Inv: QM-PAN-1001/);
  assert.match(html, /INR 74\.25/);
  assert.match(html, /Tendered.*INR 100\.00/);
  assert.match(html, /Change.*INR 25\.75/);
});

test('buildThermalReceiptHtml escapes untrusted HTML characters cleanly', () => {
  const html = buildThermalReceiptHtml({
    invoiceNumber: 'QM-PAN-1002',
    issuedAt: '11:00 AM',
    storeName: 'QuickMart <Goa> & Co',
    storeAddress: '18 "June" Road',
    gstin: '30ABCDE1234F1Z5',
    lines: [
      {
        name: '<script>alert(1)</script> Milk',
        quantity: '1',
        unitPrice: '27.00',
        lineTotal: '27.00',
      },
    ],
    subtotal: '27.00',
    taxTotal: '0.00',
    grandTotal: '27.00',
    paymentMethod: 'MOCK',
  });

  assert.equal(html.includes('<script>'), false);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Milk/);
  assert.match(html, /QuickMart &lt;Goa&gt; &amp; Co/);
  assert.equal(html.includes('Tendered'), false);
});
