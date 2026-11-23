'use client';

import { useQuery } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { env } from '@/lib/env';
import { useAuthStore } from '@/lib/auth-store';
import { fetchMe } from '@/lib/api-client';
import { recentOrders } from '@/lib/pos-client';
import { fetchDashboardSummary, fetchSalesByHour, fetchTopProducts } from '@/lib/inventory-client';
import { Card } from '@/components/ui/card';

interface LiveOrder {
  orderId: string;
  channel: string;
  status: string;
  grandTotal: string;
  receiptNumber: string | null;
  placedAt: string;
}

/**
 * Live activity feed (Phase 4 scope): Socket.IO push for new orders + REST
 * refetch as source of truth. Charts/metrics land in Phase 5, derived from
 * the database — nothing here is hardcoded.
 */
export default function DashboardPage() {
  const router = useRouter();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false });
  const [live, setLive] = useState<LiveOrder[]>([]);
  const [connected, setConnected] = useState(false);

  const ordersQuery = useQuery({
    queryKey: ['dashboard-recent'],
    queryFn: recentOrders,
    enabled: meQuery.isSuccess,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!meQuery.isSuccess || !meQuery.data) return;
    if (!env.API_BASE_URL) {
      // Same-origin Next.js standalone mode relies on REST polling cleanly.
      setConnected(true);
      return;
    }
    const token = useAuthStore.getState().accessToken;
    const socket: Socket = io(env.API_BASE_URL, {
      transports: ['websocket'],
      auth: { token },
      reconnectionDelayMax: 10_000,
    });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('order.completed', (payload: LiveOrder) => {
      setLive((current) =>
        [{ ...payload, placedAt: new Date().toISOString() }, ...current].slice(0, 10),
      );
      void ordersQuery.refetch();
    });
    socket.on('inventory.updated', () => void ordersQuery.refetch());
    return () => {
      socket.close();
    };
  }, [meQuery.isSuccess, meQuery.data?.id]);

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
  if (!meQuery.data.permissions.some((p) => p.startsWith('dashboard:view'))) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-ink-2">
        Your role does not include dashboard access.
      </p>
    );
  }

  const orders: LiveOrder[] = live.length > 0 ? live : (ordersQuery.data ?? []);

  return (
    <div className="flex flex-1 flex-col gap-6 pb-16 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live activity</h1>
          <p className="text-sm text-ink-2">
            Real-time order feed — Socket.IO notifications, REST as source of truth.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset ${
            connected
              ? 'bg-emerald-50 text-accent ring-accent/20'
              : 'bg-raised text-ink-2 ring-line'
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${connected ? 'bg-accent' : 'bg-zinc-400 animate-pulse'}`}
          />
          {connected ? 'Live' : 'Connecting…'}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard
          queryKey="dash-summary"
          label="Today"
          fetcher={fetchDashboardSummary}
          render={(s) => [`₹${s.grossSales}`, `${s.orders} orders · avg ₹${s.averageBasket}`]}
        />
        <MetricCard
          queryKey="dash-top"
          label="Top products"
          fetcher={fetchTopProducts}
          render={(t) => [t[0]?.name ?? '—', t[0] ? `₹${t[0].revenue}` : 'no sales yet']}
        />
        <MetricCard
          queryKey="dash-hours"
          label="Peak hour (24h)"
          fetcher={fetchSalesByHour}
          render={(h) => {
            const peak = h.reduce((a, b) => (b.total > a.total ? b : a), h[0]!);
            return [
              peak && peak.orders > 0
                ? `h${String(peak.hour).padStart(2, '0')} · ₹${peak.total}`
                : '—',
              `₹${h.reduce((s, x) => s + Number(x.total), 0).toFixed(2)} in 24h`,
            ];
          }}
        />
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-2">
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Channel</th>
              <th className="px-4 py-3 font-medium">Receipt</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Total</th>
              <th className="px-4 py-3 font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ordersQuery.isPending && orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-2">
                  Loading…
                </td>
              </tr>
            )}
            {orders.map((order) => (
              <tr key={order.orderId} className="hover:bg-raised">
                <td className="px-4 py-3 font-mono text-[13px] text-ink-2">
                  {order.orderId.slice(0, 8)}…
                </td>
                <td className="px-4 py-3 text-ink-2">
                  {order.channel === 'POS' ? 'Register' : 'Self-checkout'}
                </td>
                <td className="px-4 py-3 font-mono text-[13px] text-ink-2">
                  {order.receiptNumber ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-md bg-raised px-2 py-0.5 font-mono text-xs">
                    {order.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium tabular-nums">
                  ₹{order.grandTotal}
                </td>
                <td className="px-4 py-3 text-xs text-ink-2">
                  {new Date(order.placedAt).toLocaleTimeString()}
                </td>
              </tr>
            ))}
            {orders.length === 0 && !ordersQuery.isPending && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-2">
                  No orders yet — run a sale on /shop or /pos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-ink-3">
        Event catalogue: order.completed · inventory.updated · alert.low_stock — documented in
        docs/api-guidelines.md. Charts and metrics: Phase 5.
      </p>
    </div>
  );
}

function MetricCard<T>({
  queryKey,
  label,
  fetcher,
  render,
}: {
  queryKey: string;
  label: string;
  fetcher: () => Promise<T>;
  render: (data: T) => [string, string];
}) {
  const query = useQuery({ queryKey: [queryKey], queryFn: fetcher });
  return (
    <Card>
      <p className="text-xs font-medium text-ink-2">{label}</p>
      {query.isPending ? (
        <div className="mt-2 h-7 w-24 animate-pulse rounded bg-raised" />
      ) : (
        <>
          <p className="mt-1 text-xl font-semibold tracking-tight">
            {query.data ? render(query.data)[0] : '—'}
          </p>
          <p className="text-xs text-ink-2">{query.data ? render(query.data)[1] : ''}</p>
        </>
      )}
    </Card>
  );
}
