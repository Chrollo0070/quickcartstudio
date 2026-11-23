import { API_PREFIX } from '@quickcart/shared';
import { env } from './env';

/**
 * Customer checkout API calls. The session token (received at creation) is
 * possession-based auth — it stays in sessionStorage, never in the API store.
 */
export interface CheckoutSession {
  sessionId: string;
  sessionToken: string;
  expiresAt: string;
}

export interface CartItem {
  itemId: string;
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  isWeighed: boolean;
  quantity: string;
  unitPrice: string;
}

export interface SessionView {
  id: string;
  branchId: string;
  channel: string;
  status: string;
  expiresAt: string;
  items: CartItem[];
}

export interface QuoteLineTax {
  name: 'CGST' | 'SGST' | 'IGST';
  rate: string;
  basisAmount: string;
  amount: string;
}

export interface QuoteLine {
  productId: string;
  name: string;
  quantity: string;
  unitPrice: string;
  lineSubtotal: string;
  lineDiscountTotal: string;
  taxableValue: string;
  lineTaxTotal: string;
  lineTotal: string;
  taxSplit: 'CGST_SGST' | 'IGST';
  taxLines: QuoteLineTax[];
}

export interface CartQuote {
  currency: string;
  subtotal: string;
  itemDiscountTotal: string;
  couponDiscountTotal: string;
  taxTotal: string;
  grandTotal: string;
  couponApplied: { code: string; discount: string } | null;
  loyaltyApplied: { points: number; discount: string } | null;
  couponError?: string;
  lines: QuoteLine[];
  hash: string;
}

export interface SearchProduct {
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  unit: string;
  isWeighed: boolean;
  unitPrice: string;
  availableStock: string;
}

export interface ScanResult {
  itemId: string;
  productId: string;
  name: string;
  quantity: string;
  unitPrice: string;
  isWeighed: boolean;
}

export interface ConfirmResult {
  orderId: string;
  status: string;
  sessionId: string;
  retry?: boolean;
}

export interface ApiProblem extends Error {
  status: number;
  code?: string;
  body?: unknown;
}

async function call<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const base = env.API_BASE_URL === '' ? '/' : `${env.API_BASE_URL}/`;
  const response = await fetch(`${base}${API_PREFIX}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'x-session-token': token,
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const problem = body as { message?: string; code?: string };
    const error = new Error(
      problem?.message ?? `Request failed (${response.status})`,
    ) as ApiProblem;
    error.status = response.status;
    error.code = problem?.code;
    error.body = body;
    throw error;
  }
  return body as T;
}

export function createSession(branchId: string): Promise<CheckoutSession> {
  const base = env.API_BASE_URL === '' ? '/' : `${env.API_BASE_URL}/`;
  return fetch(`${base}${API_PREFIX}/checkout/sessions`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ branchId }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Failed to start session (${response.status})`);
    return (await response.json()) as CheckoutSession;
  });
}

export const getSession = (s: CheckoutSession) =>
  call<SessionView>(`/checkout/sessions/${s.sessionId}`, s.sessionToken);

export const searchProducts = (s: CheckoutSession, q: string) =>
  call<SearchProduct[]>(
    `/checkout/sessions/${s.sessionId}/search?q=${encodeURIComponent(q)}`,
    s.sessionToken,
  );

export const scan = (s: CheckoutSession, barcode: string) =>
  call<ScanResult>(`/checkout/sessions/${s.sessionId}/items/scan`, s.sessionToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ barcode }),
  });

export const updateQuantity = (s: CheckoutSession, itemId: string, quantity: string) =>
  call<SessionView>(`/checkout/sessions/${s.sessionId}/items/${itemId}`, s.sessionToken, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quantity }),
  });

export const removeItem = (s: CheckoutSession, itemId: string) =>
  call<SessionView>(`/checkout/sessions/${s.sessionId}/items/${itemId}`, s.sessionToken, {
    method: 'DELETE',
  });

export const quoteCart = (s: CheckoutSession, couponCode?: string, loyaltyPoints?: number) =>
  call<{ quote: CartQuote }>(`/checkout/sessions/${s.sessionId}/quote`, s.sessionToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(couponCode ? { couponCode } : {}),
      ...(loyaltyPoints ? { loyaltyPoints } : {}),
    }),
  });

export function attachCustomer(
  session: CheckoutSession,
  phone: string,
): Promise<{ customerId: string; name: string; loyaltyPoints: number }> {
  return call('/checkout/sessions/' + session.sessionId + '/customer', session.sessionToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
}

export const confirmCart = (
  s: CheckoutSession,
  idempotencyKey: string,
  expectedQuoteHash?: string,
) =>
  call<ConfirmResult>(`/checkout/sessions/${s.sessionId}/confirm`, s.sessionToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      expectedQuoteHash ? { idempotencyKey, expectedQuoteHash } : { idempotencyKey },
    ),
  });

export const cancelSession = (s: CheckoutSession) =>
  call<{ sessionId: string; status: string }>(
    `/checkout/sessions/${s.sessionId}/cancel`,
    s.sessionToken,
    { method: 'POST' },
  );

export interface PaymentIntentResult {
  paymentId: string;
  provider: string;
  providerRef: string;
  status: string;
  orderId: string;
}

export interface Receipt {
  invoiceNumber: string;
  issuedAt: string;
  payload: {
    store: {
      name: string;
      code: string;
      gstin: string | null;
      city: string | null;
      address: string | null;
    };
    lines: Array<{
      name: string;
      quantity: string;
      unit: string;
      unitPrice: string;
      lineTotal: string;
      lineTaxTotal: string;
      taxableValue: string;
      taxLines: Array<{ name: string; amount: string; rate: string }>;
    }>;
    totals: {
      subtotal: string;
      itemDiscountTotal: string;
      couponDiscountTotal: string;
      taxTotal: string;
      grandTotal: string;
    };
    payment: { provider: string; amount: string; currency: string };
  };
}

export function createIntent(
  session: CheckoutSession,
  orderId: string,
  idempotencyKey: string,
): Promise<PaymentIntentResult> {
  return call<PaymentIntentResult>('/payments/intent', session.sessionToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId, idempotencyKey }),
  });
}

export function mockSettlePayment(
  session: CheckoutSession,
  paymentId: string,
): Promise<{ settled: boolean; receiptNumber?: string }> {
  return call('/payments/' + paymentId + '/mock-settle', session.sessionToken, { method: 'POST' });
}

export function fetchReceipt(session: CheckoutSession, orderId: string): Promise<Receipt> {
  return call('/orders/' + orderId + '/receipt', session.sessionToken);
}
