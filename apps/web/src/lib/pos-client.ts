import { request } from './api-client';

/**
 * Staff POS API calls — JWT-authenticated (the api-client adds the bearer
 * token), permission-gated server-side by `pos:operate` etc.
 */
export interface PosSessionView {
  sessionId: string;
  branchId: string;
}

export interface PosItem {
  barcode?: string;
  itemId: string;
  productId: string;
  name: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  isWeighed: boolean;
  availableStock?: string;
}

export interface CartView {
  id: string;
  status: string;
  items: PosItem[];
}

export interface ShiftSummary {
  shift: {
    id: string;
    openedAt: string;
    openingCash: string;
    orders: number;
    cashOrders: number;
    cashCollected: string;
    expectedDrawer: string;
  } | null;
}

export interface PendingRefund {
  refundId: string;
  orderId: string;
  amount: string;
  currency: string;
  reason: string;
  requestedAt: string;
}

function staffRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, init);
}

export function openPosSession(): Promise<PosSessionView> {
  return staffRequest('/pos/sessions', { method: 'POST' });
}

export function listPosSessions(): Promise<
  Array<{ id: string; status: string; updatedAt: string }>
> {
  return staffRequest('/pos/sessions');
}

export function posScan(sessionId: string, barcode: string): Promise<PosItem> {
  return staffRequest(`/pos/sessions/${sessionId}/items/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode }),
  });
}

export function posSearch(sessionId: string, q: string): Promise<PosItem[]> {
  return staffRequest(`/checkout/sessions/${sessionId}/search?q=${encodeURIComponent(q)}`);
}

export function posGetSession(sessionId: string): Promise<CartView> {
  return staffRequest(`/checkout/sessions/${sessionId}`);
}

export function posUpdateQty(
  sessionId: string,
  itemId: string,
  quantity: string,
): Promise<CartView> {
  return staffRequest(`/checkout/sessions/${sessionId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  });
}

export function posRemoveItem(sessionId: string, itemId: string): Promise<CartView> {
  return staffRequest(`/checkout/sessions/${sessionId}/items/${itemId}`, { method: 'DELETE' });
}

export function posQuote(
  sessionId: string,
): Promise<{ quote: { grandTotal: string; taxTotal: string; subtotal: string; hash: string } }> {
  return staffRequest(`/checkout/sessions/${sessionId}/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export function posSuspend(sessionId: string): Promise<unknown> {
  return staffRequest(`/pos/sessions/${sessionId}/suspend`, { method: 'POST' });
}

export function posResume(sessionId: string): Promise<CartView> {
  return staffRequest(`/pos/sessions/${sessionId}/resume`, { method: 'POST' });
}

export function posComplete(
  sessionId: string,
  paymentMethod: 'CASH' | 'MOCK',
  idempotencyKey: string,
  expectedQuoteHash?: string,
): Promise<{ orderId: string; status: string; receiptNumber?: string; retry?: boolean }> {
  return staffRequest(`/pos/sessions/${sessionId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      expectedQuoteHash
        ? { paymentMethod, idempotencyKey, expectedQuoteHash }
        : { paymentMethod, idempotencyKey },
    ),
  });
}

export function posOpenShift(openingCash: string): Promise<unknown> {
  return staffRequest('/pos/shifts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ openingCash }),
  });
}

export function posCurrentShift(): Promise<ShiftSummary> {
  return staffRequest('/pos/shifts/current');
}

export function posCloseShift(closingCash: string): Promise<unknown> {
  return staffRequest('/pos/shifts/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ closingCash }),
  });
}

export function posRequestRefund(
  orderId: string,
  reason: string,
): Promise<{ refundId: string; status: string }> {
  return staffRequest('/pos/refunds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, reason, idempotencyKey: crypto.randomUUID() }),
  });
}

export function posPendingRefunds(): Promise<PendingRefund[]> {
  return staffRequest('/pos/refunds');
}

export function posApproveRefund(refundId: string): Promise<{ refundId: string; status: string }> {
  return staffRequest(`/pos/refunds/${refundId}/approve`, { method: 'POST' });
}

export function recentOrders(): Promise<
  Array<{
    orderId: string;
    channel: string;
    status: string;
    grandTotal: string;
    receiptNumber: string | null;
    placedAt: string;
  }>
> {
  return staffRequest('/dashboard/recent-orders');
}
