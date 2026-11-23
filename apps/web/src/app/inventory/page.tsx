'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fetchMe } from '@/lib/api-client';
import {
  approveCount,
  createAdjustment,
  createCount,
  createReceipt,
  fetchAlerts,
  fetchBalances,
  fetchCounts,
  type Alerts,
  type BalanceRow,
  type CountRow,
} from '@/lib/inventory-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

export default function InventoryPage() {
  const router = useRouter();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false });

  if (meQuery.isPending) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-ink-2">
        Checking session…
      </p>
    );
  }
  if (meQuery.isError) {
    router.replace('/login');
    return null;
  }
  if (!meQuery.data.permissions.includes('inventory:read')) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-ink-2">
        Your role does not include inventory access.
      </p>
    );
  }

  return <InventoryWorkspace permissions={meQuery.data.permissions} />;
}

function InventoryWorkspace({ permissions }: { permissions: string[] }) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const balancesQuery = useQuery({ queryKey: ['inventory'], queryFn: fetchBalances });
  const alertsQuery = useQuery({ queryKey: ['inventory-alerts'], queryFn: fetchAlerts });
  const countsQuery = useQuery({ queryKey: ['inventory-counts'], queryFn: fetchCounts });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory-alerts'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory-counts'] });
  };

  const adjust = useMutation({
    mutationFn: (input: { productId: string; delta: string; reason: string }) =>
      createAdjustment(input.productId, input.delta, input.reason),
    onSuccess: () => {
      setFeedback({ ok: true, text: 'Adjustment posted to the ledger' });
      invalidate();
    },
    onError: (error) => setFeedback({ ok: false, text: (error as Error).message }),
  });

  const receive = useMutation({
    mutationFn: createReceipt,
    onSuccess: (result) => {
      setFeedback({ ok: true, text: `Goods receipt ${result.receiptNumber} completed` });
      invalidate();
    },
    onError: (error) => setFeedback({ ok: false, text: (error as Error).message }),
  });

  const count = useMutation({
    mutationFn: createCount,
    onSuccess: (result) => {
      setFeedback({ ok: true, text: `Count ${result.countNumber} opened (${result.lines} lines)` });
      invalidate();
    },
  });

  const approve = useMutation({
    mutationFn: approveCount,
    onSuccess: (result) => {
      setFeedback({
        ok: true,
        text: `Count approved — ${result.adjustmentsPosted} adjustments posted`,
      });
      invalidate();
    },
  });

  const balances: BalanceRow[] = balancesQuery.data ?? [];
  const alerts: Alerts | undefined = alertsQuery.data;
  const counts: CountRow[] = countsQuery.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 pb-16 pt-4">
      <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
      {feedback && (
        <p
          className={`rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
            feedback.ok
              ? 'bg-emerald-50 text-accent ring-accent/20'
              : 'bg-[#fef2f2] text-[#b91c1c] ring-[#dc2626]/20'
          }`}
          role="status"
        >
          {feedback.text}
        </p>
      )}

      {alerts && (alerts.lowStock.length > 0 || alerts.nearExpiry.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-[#a16207]/30">
            <h2 className="text-sm font-medium text-[#a16207]">
              Low stock ({alerts.lowStock.length})
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {alerts.lowStock.slice(0, 5).map((item) => (
                <li key={item.productId} className="flex justify-between">
                  <span>{item.name}</span>
                  <span className="text-ink-2 tabular-nums">
                    {item.available}/{item.threshold} · reorder {item.suggestedReorder}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="border-red-600/20">
            <h2 className="text-sm font-medium text-[#b91c1c]">
              Near expiry — 7 days (FEFO picks these first)
            </h2>
            <ul className="mt-2 space-y-1 text-sm">
              {alerts.nearExpiry.slice(0, 5).map((b) => (
                <li key={b.batchId} className="flex justify-between">
                  <span>
                    {b.name} <span className="font-mono text-xs text-ink-3">{b.batchNumber}</span>
                  </span>
                  <span className="text-ink-2 tabular-nums">
                    {b.quantity} · exp {new Date(b.expiryDate).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium text-right">On hand</th>
              <th className="px-4 py-3 font-medium text-right">Reserved</th>
              <th className="px-4 py-3 font-medium text-right">Available</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {balances.slice(0, 20).map((b) => (
              <tr key={b.productId} className={b.isLowStock ? 'bg-[#fef9c3]/40' : ''}>
                <td className="px-4 py-3">
                  <span className="font-medium text-ink">{b.name}</span>
                  <span className="ml-2 font-mono text-xs text-ink-3">{b.sku}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{b.onHand}</td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-2">{b.reserved}</td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">{b.available}</td>
                <td className="px-4 py-3">
                  {b.isLowStock ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-[#a16207] ring-1 ring-inset ring-amber-600/20">
                      Low
                    </span>
                  ) : (
                    <span className="text-xs text-ink-3">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {permissions.includes('inventory:adjust') && (
          <AdjustForm balances={balances} onSubmit={adjust.mutate} pending={adjust.isPending} />
        )}
        {permissions.includes('inventory:receive') && (
          <ReceiveForm balances={balances} onSubmit={receive.mutate} pending={receive.isPending} />
        )}
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-2">Stock counts</h2>
          {permissions.includes('inventory:adjust') && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => count.mutate()}
              disabled={count.isPending}
            >
              Open count (snapshot)
            </Button>
          )}
        </div>
        <ul className="mt-3 divide-y divide-line">
          {counts.map((c) => (
            <li key={c.countId} className="flex items-center justify-between py-2 text-sm">
              <span>
                <span className="font-mono text-[13px]">{c.countNumber}</span>
                <span className="ml-2 text-xs text-ink-2">{c.lines} lines</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="rounded-md bg-raised px-2 py-0.5 font-mono text-xs">
                  {c.status}
                </span>
                {c.status === 'PENDING_APPROVAL' &&
                  permissions.includes('inventory:adjust:approve') && (
                    <Button size="sm" variant="secondary" onClick={() => approve.mutate(c.countId)}>
                      Approve
                    </Button>
                  )}
              </span>
            </li>
          ))}
          {counts.length === 0 && <li className="py-2 text-sm text-ink-2">No counts yet.</li>}
        </ul>
        <p className="mt-2 text-xs text-ink-3">
          Untouched lines count as system quantity — only submitted variances post adjustments on
          approval. Counted-quantity entry: API (
          <code className="font-mono">POST /inventory/counts/:id/submit</code>).
        </p>
      </Card>
    </div>
  );
}

function AdjustForm({
  balances,
  onSubmit,
  pending,
}: {
  balances: BalanceRow[];
  onSubmit: (input: { productId: string; delta: string; reason: string }) => void;
  pending: boolean;
}) {
  const [productId, setProductId] = useState('');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Card>
      <h2 className="text-sm font-medium text-ink-2">Manual adjustment (audited)</h2>
      <div className="mt-3 flex flex-col gap-2">
        <select
          className="h-10 rounded-lg bg-card px-3 text-sm ring-1 ring-inset ring-line"
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          aria-label="Product"
        >
          <option value="">Select product…</option>
          {balances.slice(0, 20).map((b) => (
            <option key={b.productId} value={b.productId}>
              {b.name} ({b.available} {b.unit})
            </option>
          ))}
        </select>
        <Input
          placeholder="Delta, e.g. 2.000 or -1.500"
          value={delta}
          onChange={(event) => setDelta(event.target.value)}
          aria-label="Quantity delta"
        />
        <Input
          placeholder="Reason (required)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          aria-label="Reason"
        />
        <Button
          disabled={pending || !productId || !/^-?\d+\.\d{3}$/.test(delta) || reason.length < 3}
          onClick={() => onSubmit({ productId, delta, reason })}
        >
          Post adjustment
        </Button>
      </div>
    </Card>
  );
}

function ReceiveForm({
  balances,
  onSubmit,
  pending,
}: {
  balances: BalanceRow[];
  onSubmit: (
    lines: Array<{
      productId: string;
      batchNumber: string;
      expiryDate?: string;
      quantity: string;
      unitCost?: string;
    }>,
  ) => void;
  pending: boolean;
}) {
  const [productId, setProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [quantity, setQuantity] = useState('');
  const valid = productId && batchNumber && /^\d+\.\d{3}$/.test(quantity);
  return (
    <Card>
      <h2 className="text-sm font-medium text-ink-2">Receive goods (creates batch + ledger)</h2>
      <div className="mt-3 flex flex-col gap-2">
        <select
          className="h-10 rounded-lg bg-card px-3 text-sm ring-1 ring-inset ring-line"
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          aria-label="Product"
        >
          <option value="">Select product…</option>
          {balances.slice(0, 20).map((b) => (
            <option key={b.productId} value={b.productId}>
              {b.name}
            </option>
          ))}
        </select>
        <Input
          placeholder="Batch number"
          value={batchNumber}
          onChange={(e) => setBatchNumber(e.target.value)}
          aria-label="Batch number"
        />
        <Input
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          aria-label="Expiry date"
        />
        <Input
          placeholder="Quantity, e.g. 5.000"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          aria-label="Quantity"
        />
        <Button
          disabled={pending || !valid}
          onClick={() =>
            onSubmit([
              {
                productId,
                batchNumber,
                quantity,
                expiryDate: expiryDate || undefined,
              },
            ])
          }
        >
          Receive
        </Button>
      </div>
    </Card>
  );
}
