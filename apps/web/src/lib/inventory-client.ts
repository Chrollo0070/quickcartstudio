import { request } from './api-client';

export interface BalanceRow {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  onHand: string;
  reserved: string;
  available: string;
  lowStockThreshold: string;
  isLowStock: boolean;
}

export interface Alerts {
  lowStock: Array<{
    productId: string;
    name: string;
    sku: string;
    available: string;
    threshold: string;
    suggestedReorder: string;
  }>;
  nearExpiry: Array<{
    batchId: string;
    productId: string;
    name: string;
    batchNumber: string;
    expiryDate: string;
    quantity: string;
  }>;
}

export interface MovementRow {
  id: string;
  type: string;
  quantity: string;
  reason: string | null;
  product: { name: string; sku: string };
  createdAt: string;
}

export interface CountRow {
  countId: string;
  countNumber: string;
  status: string;
  lines: number;
  startedAt: string;
}

export function fetchBalances(): Promise<BalanceRow[]> {
  return request('/inventory');
}

export function fetchAlerts(): Promise<Alerts> {
  return request('/inventory/alerts');
}

export function fetchMovements(
  page = 1,
): Promise<{ data: MovementRow[]; meta: { total: number; page: number; totalPages: number } }> {
  return request(`/inventory/movements?page=${page}&limit=15`);
}

export function createAdjustment(
  productId: string,
  quantityDelta: string,
  reason: string,
): Promise<unknown> {
  return request('/inventory/adjustments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, quantityDelta, reason }),
  });
}

export function createReceipt(
  lines: Array<{
    productId: string;
    batchNumber: string;
    expiryDate?: string;
    quantity: string;
    unitCost?: string;
  }>,
): Promise<{ receiptNumber: string }> {
  return request('/inventory/receipts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines }),
  });
}

export function createCount(): Promise<{ countId: string; countNumber: string; lines: number }> {
  return request('/inventory/counts', { method: 'POST' });
}

export function fetchCounts(): Promise<CountRow[]> {
  return request('/inventory/counts');
}

export function approveCount(
  countId: string,
): Promise<{ status: string; adjustmentsPosted: number }> {
  return request(`/inventory/counts/${countId}/approve`, { method: 'POST' });
}

export function fetchDashboardSummary(): Promise<{
  orders: number;
  grossSales: string;
  averageBasket: string;
  paymentMix: Array<{ provider: string; orders: number; total: string }>;
}> {
  return request('/dashboard/summary');
}

export function fetchSalesByHour(): Promise<
  Array<{ hour: number; orders: number; total: string }>
> {
  return request('/dashboard/sales');
}

export function fetchTopProducts(): Promise<
  Array<{ productId: string; name: string; sku: string; unitsSold: string; revenue: string }>
> {
  return request('/dashboard/top-products');
}
