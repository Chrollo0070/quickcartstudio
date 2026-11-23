import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTenderChange,
  formatThermalText,
  suggestCashDenominations,
} from './desktop-receipt';

test('calculateTenderChange computes exact change and shortfall cleanly', () => {
  const exact = calculateTenderChange(74.25, 100);
  assert.equal(exact.valid, true);
  assert.equal(exact.changeDue, '25.75');
  assert.equal(exact.shortfall, '0.00');

  const short = calculateTenderChange(101.25, 100);
  assert.equal(short.valid, false);
  assert.equal(short.changeDue, '0.00');
  assert.equal(short.shortfall, '1.25');
});

test('suggestCashDenominations returns ascending unique INR amounts >= total', () => {
  const options = suggestCashDenominations(74.25);
  assert.ok(options.length >= 3 && options.length <= 4);
  assert.equal(options[0], 75);
  assert.ok(options.includes(100));
  assert.ok(options.every((amount) => amount >= 74.25));
});

test('formatThermalText respects 42-char 80mm paper width and includes totals', () => {
  const slip = formatThermalText(
    {
      invoiceNumber: 'QM-PAN-1001',
      issuedAt: '10:30 AM',
      storeName: 'QuickMart Panaji',
      storeAddress: '18 June Road, Panaji',
      gstin: '30ABCDE1234F1Z5',
      lines: [
        { name: 'Amul Toned Milk 500ml', quantity: '2', unitPrice: '27.00', lineTotal: '54.00' },
        { name: 'Britannia White Bread 400g', quantity: '1', unitPrice: '45.00', lineTotal: '47.25' },
      ],
      subtotal: '99.00',
      taxTotal: '2.25',
      grandTotal: '101.25',
      paymentMethod: 'CASH',
      tendered: '200.00',
      changeDue: '98.75',
    },
    42,
  );
  const lines = slip.split('\n');
  assert.ok(lines.every((line) => line.length <= 42));
  assert.ok(slip.includes('INV QM-PAN-1001'));
  assert.ok(slip.includes('INR 101.25'));
  assert.ok(slip.includes('INR 98.75'));
});
