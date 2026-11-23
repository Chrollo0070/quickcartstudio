'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createAdjustment,
  fetchAlerts,
  fetchBalances,
  type BalanceRow,
} from '@/lib/inventory-client';

type StockFilter = 'all' | 'low' | 'expiry';

export function DesktopStockView({ canAdjust }: { canAdjust: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<StockFilter>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const balancesQuery = useQuery({ queryKey: ['desktop-inventory'], queryFn: fetchBalances });
  const alertsQuery = useQuery({ queryKey: ['desktop-alerts'], queryFn: fetchAlerts });

  const quickRestock = useMutation({
    mutationFn: (productId: string) =>
      createAdjustment(productId, '10.000', 'Desktop quick restock (+10)'),
    onSuccess: () => {
      setNotice('Posted +10.000 restock adjustment to the branch ledger.');
      void queryClient.invalidateQueries({ queryKey: ['desktop-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['desktop-alerts'] });
    },
    onError: (err) => setNotice((err as Error).message),
  });

  const balances: BalanceRow[] = balancesQuery.data ?? [];
  const alerts = alertsQuery.data;
  const q = search.trim().toLowerCase();

  const filteredBalances = balances.filter((row) => {
    if (filter === 'low' && !row.isLowStock) return false;
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || row.sku.toLowerCase().includes(q);
  });

  return (
    <div data-testid="desktop-stock-view" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg bg-raised p-1">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              filter === 'all' ? 'bg-card text-ink shadow-xs' : 'text-ink-2 hover:text-ink'
            }`}
          >
            All items ({balances.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('low')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              filter === 'low' ? 'bg-card text-ink shadow-xs' : 'text-ink-2 hover:text-ink'
            }`}
          >
            Low stock ({alerts?.lowStock.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setFilter('expiry')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              filter === 'expiry' ? 'bg-card text-ink shadow-xs' : 'text-ink-2 hover:text-ink'
            }`}
          >
            Near expiry ({alerts?.nearExpiry.length ?? 0})
          </button>
        </div>

        <div className="w-full max-w-xs">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter SKU or product name…"
            aria-label="Filter stock ledger"
          />
        </div>
      </div>

      {notice && (
        <p className="rounded-lg border border-accent/25 bg-accent-soft px-3.5 py-2 text-sm text-accent">
          {notice}
        </p>
      )}

      {filter === 'expiry' ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Batch</th>
                <th className="px-4 py-3 font-medium text-right">Quantity</th>
                <th className="px-4 py-3 font-medium text-right">Expiry date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(alerts?.nearExpiry ?? []).map((batch) => (
                <tr key={batch.batchId} className="hover:bg-paper">
                  <td className="px-4 py-2.5 font-medium text-ink">{batch.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-2">{batch.batchNumber}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink">
                    {batch.quantity}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs font-medium text-[#b91c1c] tabular-nums">
                    {new Date(batch.expiryDate).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {(!alerts || alerts.nearExpiry.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-sm text-ink-2">
                    No batches expiring within the next 7 days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-2">
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium text-right">On hand</th>
                <th className="px-4 py-3 font-medium text-right">Reserved</th>
                <th className="px-4 py-3 font-medium text-right">Available</th>
                <th className="px-4 py-3 font-medium">State</th>
                {canAdjust && <th className="px-4 py-3 font-medium text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {balancesQuery.isPending &&
                Array.from({ length: 6 }).map((_, idx) => (
                  <tr key={idx}>
                    <td colSpan={canAdjust ? 6 : 5} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-raised" />
                    </td>
                  </tr>
                ))}
              {filteredBalances.slice(0, 24).map((row) => (
                <tr key={row.productId} className="hover:bg-paper">
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink">{row.name}</span>
                    <span className="ml-2 font-mono text-xs text-ink-3">{row.sku}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-2">
                    {row.onHand}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-3">
                    {row.reserved}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-medium tabular-nums text-ink">
                    {row.available}
                  </td>
                  <td className="px-4 py-2.5 text-xs">
                    {row.isLowStock ? (
                      <span className="font-medium text-[#a16207]">Low stock</span>
                    ) : (
                      <span className="text-ink-3">Nominal</span>
                    )}
                  </td>
                  {canAdjust && (
                    <td className="px-4 py-2.5 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={quickRestock.isPending}
                        onClick={() => quickRestock.mutate(row.productId)}
                      >
                        +10 restock
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {!balancesQuery.isPending && filteredBalances.length === 0 && (
                <tr>
                  <td colSpan={canAdjust ? 6 : 5} className="px-4 py-8 text-center text-sm text-ink-2">
                    No inventory rows match your current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
