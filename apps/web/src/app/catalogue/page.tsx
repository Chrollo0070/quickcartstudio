'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { fetchMe, fetchProducts } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * Staff catalogue (Phase 1 scope): live search, pagination, branch stock from
 * the API. The barcode-scanner customer flow builds on this data in Phase 2.
 */
export default function CataloguePage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  // Auth gate: /users/me restores the session — the api client transparently
  // refreshes an expired access token and repopulates the auth store, so a
  // 401/failed query here really means "not signed in".
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false });

  const productsQuery = useQuery({
    queryKey: ['products', { page, q: debounced }],
    queryFn: () => fetchProducts({ page, limit: 10, q: debounced || undefined }),
    enabled: meQuery.isSuccess,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  if (meQuery.isPending) {
    return <p className="p-8 text-sm text-ink-2">Checking your session…</p>;
  }
  if (meQuery.isError) {
    router.replace('/login');
    return null;
  }

  const products = productsQuery.data;

  return (
    <div className="flex flex-1 flex-col gap-6 pb-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Product catalogue</h1>
          <p className="mt-1 text-sm text-ink-2">
            {products ? `${products.meta.total} products` : 'Loading…'}
            {meQuery.data.branch ? ` · ${meQuery.data.branch.name}` : ''}
          </p>
        </div>
        <div className="w-full max-w-sm">
          <Input
            type="search"
            placeholder="Search by name, SKU or barcode…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search products"
          />
        </div>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">Sku</th>
              <th className="px-4 py-3 font-medium">Barcode</th>
              <th className="px-4 py-3 font-medium text-right">Price</th>
              <th className="px-4 py-3 font-medium">Gst</th>
              <th className="px-4 py-3 font-medium">Unit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {productsQuery.isPending &&
              Array.from({ length: 5 }).map((_, index) => (
                <tr key={`skeleton-${index}`}>
                  <td className="px-4 py-3" colSpan={6}>
                    <div className="h-4 w-full animate-pulse rounded bg-raised" />
                  </td>
                </tr>
              ))}
            {products?.data.map((product) => (
              <tr key={product.id} className="hover:bg-raised">
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{product.name}</span>
                  {product.brand && (
                    <span className="ml-2 text-xs text-ink-2">{product.brand.name}</span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-[13px] text-ink-2">{product.sku}</td>
                <td className="px-4 py-3 font-mono text-[13px] text-ink-2">
                  {product.barcodes[0] ?? '—'}
                </td>
                <td className="px-4 py-3 text-right font-medium text-ink tabular-nums">
                  ₹{product.sellingPrice}
                </td>
                <td className="px-4 py-3 text-ink-2">{product.taxCategory.name}</td>
                <td className="px-4 py-3 text-ink-2">{product.unit}</td>
              </tr>
            ))}
            {products && products.data.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-2">
                  No products match “{debounced}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      {products && products.meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-ink-2">
          <span>
            Page {products.meta.page} of {products.meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => current - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= products.meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
