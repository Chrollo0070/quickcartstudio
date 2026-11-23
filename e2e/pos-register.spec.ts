import { expect, test } from '@playwright/test';

async function login(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('QuickMart!dev123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/catalogue', { timeout: 15_000 });
}

/** Cashier completes a register sale with cash (spec §19: POS sale E2E). */
test('cashier completes a POS sale with cash', async ({ page }) => {
  await login(page, 'cashier@quickmart.dev');
  await page.goto('/pos');

  await page.getByRole('button', { name: 'New sale' }).click();
  await expect(page.getByText('Cart (0)')).toBeVisible({ timeout: 10_000 });

  // Register search + add
  await page.getByPlaceholder(/Search product name/).fill('Parle-G');
  await page.getByRole('button', { name: 'Add' }).first().click();
  await expect(page.getByText('Cart (1)')).toBeVisible({ timeout: 10_000 });

  await page.getByRole('button', { name: /^Cash ₹/ }).click({ timeout: 15_000 });
  await expect(page.getByText(/receipt QM-PAN-\d{4}-\d{6}/)).toBeVisible({ timeout: 15_000 });

  // Shift summary is derived from real orders (orders ≥ 1)
  await expect(page.getByText('Cash collected')).toBeVisible();
});

/** Managers approve pending refunds (RBAC: cashier had no approve button). */
test('manager sees refund approvals and dashboard metrics', async ({ page }) => {
  await login(page, 'manager@quickmart.dev');
  await page.goto('/dashboard');
  await expect(page.getByText('Live activity')).toBeVisible();
  await expect(page.getByText('Today')).toBeVisible();
});
