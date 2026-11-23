import { expect, test } from '@playwright/test';

/**
 * Customer self-checkout happy path (spec §18 demo): search → add → quantity →
 * checkout → demo payment → receipt. Uses manual search (camera scanning needs
 * a physical camera — the barcode endpoint is covered by API smoke tests).
 */
test('customer scans/searches, carts, pays and sees the receipt', async ({ page }) => {
  await page.goto('/shop');
  await page.waitForLoadState('networkidle');
  await page.getByText('QuickMart Panaji').click();

  // Manual search fallback (spec §6)
  await page.getByPlaceholder('Search products').fill('Aashirvaad');
  await page.getByRole('button', { name: 'Add' }).first().click();
  await expect(page.getByRole('status')).toContainText('added', { timeout: 10_000 });

  // Quantity change (spec §19: cart quantity changes). The header counts
  // distinct items; the quantity shows in the server-quoted total
  // (2 × ₹245 = ₹490 + GST) — the backend is authoritative.
  await expect(page.getByTestId('cart-count')).toHaveText('1', { timeout: 10_000 });
  await page
    .getByLabel(/^Increase/)
    .first()
    .click();
  await expect(page.getByTestId('cart-count')).toHaveText('2', { timeout: 15_000 });

  // Checkout → PENDING_PAYMENT order → demo payment
  await page.getByRole('button', { name: /^Checkout · ₹/ }).click();
  await page.getByRole('button', { name: 'Pay now (demo)' }).click({ timeout: 15_000 });

  // Receipt (spec §19: receipt display)
  await expect(page.getByText(/QM-PAN-\d{4}-\d{6}/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('TOTAL').first()).toBeVisible();
});

test('empty cart cannot be confirmed and shows validation', async ({ page }) => {
  await page.goto('/shop');
  await page.getByText('QuickMart Panaji').click();
  // No totals card (and no Checkout button) while the cart is empty —
  // the server-side quote is the only source of payable amounts.
  await expect(page.getByRole('button', { name: /^Checkout ·/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel cart' }).click();
  await expect(page.getByText('Session cancelled')).toBeVisible();
});
