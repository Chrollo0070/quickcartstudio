import { expect, test } from '@playwright/test';

async function login(
  page: import('@playwright/test').Page,
  email: string,
  password = 'QuickMart!dev123',
) {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await Promise.all([
    page.waitForURL('**/catalogue', { timeout: 15_000 }),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ]);
}

test('wrong password shows a readable error (no account enumeration details)', async ({ page }) => {
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Email').fill('cashier@quickmart.dev');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByText(/Invalid credentials|Sign-in failed/i)).toBeVisible({
    timeout: 10_000,
  });
});

/** RBAC matrix: INVENTORY_STAFF has dashboard:view:branch but NOT pos:operate. */
test('inventory staff can see the dashboard but is denied the register', async ({ page }) => {
  await login(page, 'inventory@quickmart.dev');
  await page.goto('/dashboard');
  await expect(page.getByText('Live activity')).toBeVisible({ timeout: 10_000 });
  await page.goto('/pos');
  await expect(page.getByText(/does not include register access/i)).toBeVisible({
    timeout: 10_000,
  });
});

test('unauthenticated visitor is redirected to login from protected pages', async ({ page }) => {
  await page.goto('/catalogue');
  await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
});
