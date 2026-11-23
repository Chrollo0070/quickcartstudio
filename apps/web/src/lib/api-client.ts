import { API_PREFIX } from '@quickcart/shared';
import { useAuthStore } from './auth-store';
import { env } from './env';

/**
 * Thin API client with automatic access-token refresh. Error handling and
 * typed contracts grow per phase; the backend is always the source of truth —
 * the frontend never derives prices, tax, stock or payment status locally.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  branchId: string | null;
}

export interface CurrentUser extends AuthUser {
  permissions: string[];
  branch: { id: string; code: string; name: string } | null;
  lastLoginAt: string | null;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  description: string;
  timestamp: string;
  uptimeSeconds: number;
  checks: { database: 'up' | 'down' };
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  unit: string;
  sellingPrice: string;
  mrp: string | null;
  isWeighed: boolean;
  category: { id: string; name: string; slug: string } | null;
  brand: { id: string; name: string } | null;
  taxCategory: { id: string; name: string; rate: string };
  barcodes: string[];
}

export interface ProductDetail extends Product {
  branch: {
    branchId: string;
    isAvailable: boolean;
    priceOverride: string | null;
    availableStock: string;
  } | null;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

const AUTH_FREE_PATHS = ['/auth/login', '/auth/refresh'];

function errorFrom(body: unknown, status: number): ApiError {
  const parsed = body as {
    message?: string;
    code?: string;
    fieldErrors?: Record<string, string[]>;
  };
  return new ApiError(
    parsed?.message ?? `Request failed (${status})`,
    status,
    parsed?.code,
    parsed?.fieldErrors,
  );
}

async function rawRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  const base = env.API_BASE_URL === '' ? '/' : `${env.API_BASE_URL}/`;
  const response = await fetch(`${base}${API_PREFIX}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...init?.headers },
    credentials: 'include',
  });
  const body: unknown = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    return { ok: false, error: errorFrom(body, response.status) };
  }
  return { ok: true, data: body as T };
}

/**
 * Request with auth headers + one transparent refresh-and-retry on 401.
 * The refresh token lives in an httpOnly cookie set by the backend; the
 * access token is kept in memory only (never persisted to localStorage) —
 * after a full page reload the cookie-based refresh restores the session.
 */
export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isAuthFree = AUTH_FREE_PATHS.some((p) => path.startsWith(p));
  const accessToken = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  if (accessToken && !isAuthFree) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let result = await rawRequest<T>(path, { ...init, headers });
  if (result.ok) {
    return result.data;
  }
  if (result.error.status === 401 && !isAuthFree) {
    const refreshed = await rawRequest<{ accessToken: string; user: AuthUser }>('/auth/refresh', {
      method: 'POST',
    });
    if (refreshed.ok) {
      useAuthStore.getState().setSession(refreshed.data.accessToken, refreshed.data.user);
      const retry = await rawRequest<T>(path, {
        ...init,
        headers: { ...headers, Authorization: `Bearer ${refreshed.data.accessToken}` },
      });
      if (retry.ok) {
        return retry.data;
      }
      result = retry;
    } else {
      useAuthStore.getState().clearSession();
    }
  }
  throw result.error;
}

export function fetchHealth(): Promise<HealthReport> {
  return request<HealthReport>('/health');
}

export function login(
  email: string,
  password: string,
): Promise<{ accessToken: string; user: AuthUser }> {
  return request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
}

export function logout(): Promise<void> {
  return request('/auth/logout', { method: 'POST' });
}

export function fetchMe(): Promise<CurrentUser> {
  return request<CurrentUser>('/users/me');
}

export interface ProductListParams {
  page?: number;
  limit?: number;
  q?: string;
  categoryId?: string;
  branchId?: string;
}

export function fetchProducts(params: ProductListParams): Promise<Paginated<Product>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.q) search.set('q', params.q);
  if (params.categoryId) search.set('categoryId', params.categoryId);
  if (params.branchId) search.set('branchId', params.branchId);
  const qs = search.toString();
  return request<Paginated<Product>>(`/products${qs ? `?${qs}` : ''}`);
}

export function fetchBarcode(barcode: string): Promise<ProductDetail> {
  return request<ProductDetail>(`/products/barcode/${encodeURIComponent(barcode)}`);
}

export function fetchBranches(): Promise<
  Array<{ id: string; code: string; name: string; city: string | null }>
> {
  return request('/branches');
}
