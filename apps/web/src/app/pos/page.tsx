'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchMe } from '@/lib/api-client';
import {
  listPosSessions,
  openPosSession,
  posApproveRefund,
  posComplete,
  posCurrentShift,
  posGetSession,
  posPendingRefunds,
  posQuote,
  posRemoveItem,
  posRequestRefund,
  posResume,
  posScan,
  posSearch,
  posSuspend,
  posUpdateQty,
  type CartView,
  type PendingRefund,
  type PosItem,
} from '@/lib/pos-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

/**
 * Staff register (Phase 4). Keyboard-wedge scanners type the barcode + Enter —
 * the page captures fast keystrokes globally so a USB/Bluetooth scanner "just
 * works" without focusing an input. Cash settles immediately through the
 * shared pricing/order/inventory services; card runs the demo provider path.
 */
export default function PosPage() {
  const router = useRouter();
  const meQuery = useQuery({ queryKey: ['me'], queryFn: fetchMe, retry: false });
  const permissions = meQuery.data?.permissions ?? [];

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
  if (!permissions.includes('pos:operate')) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-ink-2">
        Your role ({meQuery.data.roles.join(', ')}) does not include register access.
      </p>
    );
  }

  return <Register permissions={permissions} />;
}

function Register({ permissions }: { permissions: string[] }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<CartView | null>(null);
  const [quote, setQuote] = useState<{
    grandTotal: string;
    taxTotal: string;
    subtotal: string;
    hash: string;
  } | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastCompleted, setLastCompleted] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState('');
  const wedgeBuffer = useRef({ text: '', lastAt: 0 });

  const bump = useCallback(() => {
    if (session) {
      void posGetSession(session.id).then(setSession);
      void posQuote(session.id).then((r) => setQuote(r.quote));
    }
    void queryClient.invalidateQueries({ queryKey: ['pos-shift'] });
  }, [session, queryClient]);

  const scanBarcode = useCallback(
    async (barcode: string) => {
      if (!session) return;
      try {
        const item = await posScan(session.id, barcode);
        setFeedback({ ok: true, text: `${item.name} × ${item.quantity}` });
        bump();
      } catch (error) {
        setFeedback({ ok: false, text: (error as Error).message });
      }
    },
    [session, bump],
  );

  // Keyboard-wedge capture: scanners "type" 8+ chars ending with Enter.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const now = Date.now();
      if (now - wedgeBuffer.current.lastAt > 150) wedgeBuffer.current.text = '';
      wedgeBuffer.current.lastAt = now;
      if (event.key === 'Enter') {
        const code = wedgeBuffer.current.text;
        wedgeBuffer.current.text = '';
        if (code.length >= 6 && /^[A-Za-z0-9-]+$/.test(code)) {
          void scanBarcode(code);
        }
        return;
      }
      if (/^[A-Za-z0-9-]$/.test(event.key)) {
        wedgeBuffer.current.text += event.key;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [scanBarcode]);

  const shiftQuery = useQuery({ queryKey: ['pos-shift'], queryFn: posCurrentShift });
  const parkedQuery = useQuery({ queryKey: ['pos-parked'], queryFn: listPosSessions });
  const pendingRefundsQuery = useQuery({
    queryKey: ['pos-refunds'],
    queryFn: posPendingRefunds,
    enabled: permissions.includes('pos:refund:process'),
  });

  const searchQuery = useQuery({
    queryKey: ['pos-search', session?.id],
    queryFn: () => posSearch(session!.id, 'milk'),
    enabled: false,
  });
  void searchQuery;

  const newSession = useMutation({
    mutationFn: openPosSession,
    onSuccess: async (created) => {
      const cart = await posGetSession(created.sessionId);
      setSession(cart);
      setQuote(null);
      setLastCompleted(null);
    },
  });

  const complete = useMutation({
    mutationFn: async (method: 'CASH' | 'MOCK') => {
      if (!session || !quote) throw new Error('Nothing to check out');
      return posComplete(session.id, method, crypto.randomUUID(), quote.hash);
    },
    onSuccess: (result) => {
      setLastCompleted(result.orderId);
      setSession(null);
      setQuote(null);
      setFeedback({
        ok: true,
        text: `Sale ${result.status} · receipt ${result.receiptNumber ?? ''}`,
      });
      bump();
    },
    onError: (error) => setFeedback({ ok: false, text: (error as Error).message }),
  });

  const suspend = useMutation({
    mutationFn: () => posSuspend(session!.id),
    onSuccess: () => {
      setSession(null);
      setFeedback({ ok: true, text: 'Sale parked — resume it from the list' });
      void queryClient.invalidateQueries({ queryKey: ['pos-parked'] });
    },
  });

  const requestRefund = useMutation({
    mutationFn: () => posRequestRefund(lastCompleted!, refundReason || 'Register refund'),
    onSuccess: () => {
      setFeedback({ ok: true, text: 'Refund requested — manager approval pending' });
      void queryClient.invalidateQueries({ queryKey: ['pos-refunds'] });
    },
    onError: (error) => setFeedback({ ok: false, text: (error as Error).message }),
  });

  const approveRefund = useMutation({
    mutationFn: (refundId: string) => posApproveRefund(refundId),
    onSuccess: () => {
      setFeedback({ ok: true, text: 'Refund approved — stock returned' });
      void queryClient.invalidateQueries({ queryKey: ['pos-refunds'] });
    },
  });

  const shift = shiftQuery.data?.shift;
  const pending: PendingRefund[] = pendingRefundsQuery.data ?? [];

  return (
    <div className="flex flex-1 flex-col gap-6 pb-16 pt-4 lg:flex-row">
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Register</h1>
          {!session && (
            <Button onClick={() => newSession.mutate()} disabled={newSession.isPending}>
              New sale
            </Button>
          )}
        </div>

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

        {!session ? (
          <Card>
            <h2 className="text-sm font-medium text-ink-2">Parked sales</h2>
            {(parkedQuery.data?.length ?? 0) === 0 && (
              <p className="mt-2 text-sm text-ink-2">No open or suspended sales.</p>
            )}
            <ul className="mt-3 divide-y divide-line">
              {parkedQuery.data?.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-mono text-[13px] text-ink-2">{s.id.slice(0, 8)}…</span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-md bg-raised px-2 py-0.5 font-mono text-xs">
                      {s.status}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={async () => {
                        const cart = await posResume(s.id);
                        setSession(cart);
                        void posQuote(s.id).then((r) => setQuote(r.quote));
                      }}
                    >
                      Resume
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <>
            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-ink-2">Cart ({session.items.length})</h2>
                <Button variant="ghost" size="sm" onClick={() => suspend.mutate()}>
                  Suspend
                </Button>
              </div>
              <p className="mt-1 text-xs text-ink-3">
                Scan with a USB/Bluetooth scanner (types + Enter) or use the search below.
              </p>
              <ul className="mt-3 divide-y divide-line">
                {session.items.map((item: PosItem) => (
                  <li key={item.itemId} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{item.name}</span>
                      <span className="block text-xs text-ink-2">
                        ₹{item.unitPrice}/{item.unit}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Decrease ${item.name}`}
                        onClick={() =>
                          posUpdateQty(session.id, item.itemId, decQty(item)).then((c) => {
                            setSession(c);
                            void posQuote(session.id).then((r) => setQuote(r.quote));
                          })
                        }
                      >
                        −
                      </Button>
                      <span className="w-10 text-center text-sm font-medium tabular-nums">
                        {Number(item.quantity)}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Increase ${item.name}`}
                        onClick={() =>
                          posUpdateQty(session.id, item.itemId, incQty(item))
                            .then((c) => {
                              setSession(c);
                              void posQuote(session.id).then((r) => setQuote(r.quote));
                            })
                            .catch((error) =>
                              setFeedback({ ok: false, text: (error as Error).message }),
                            )
                        }
                      >
                        +
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${item.name}`}
                        onClick={() =>
                          posRemoveItem(session.id, item.itemId).then((c) => {
                            setSession(c);
                            void posQuote(session.id).then((r) => setQuote(r.quote));
                          })
                        }
                      >
                        ✕
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <WedgeSearchInput
                sessionId={session.id}
                onAdd={(name) => {
                  setFeedback({ ok: true, text: `${name} added` });
                  bump();
                }}
              />
            </Card>

            {quote && (
              <Card className="sticky bottom-4 border-accent/20">
                <div className="flex justify-between text-sm text-ink-2">
                  <span>Subtotal</span>
                  <span className="tabular-nums">₹{quote.subtotal}</span>
                </div>
                <div className="flex justify-between text-sm text-ink-2">
                  <span>GST</span>
                  <span className="tabular-nums">₹{quote.taxTotal}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-line pt-2 text-lg font-semibold">
                  <span>Total</span>
                  <span className="tabular-nums">₹{quote.grandTotal}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button
                    size="lg"
                    onClick={() => complete.mutate('CASH')}
                    disabled={complete.isPending}
                  >
                    Cash ₹{quote.grandTotal}
                  </Button>
                  <Button
                    size="lg"
                    variant="secondary"
                    onClick={() => complete.mutate('MOCK')}
                    disabled={complete.isPending}
                  >
                    Card (demo)
                  </Button>
                </div>
              </Card>
            )}
          </>
        )}
      </div>

      <div className="flex w-full flex-col gap-4 lg:w-80">
        <Card>
          <h2 className="text-sm font-medium text-ink-2">Shift</h2>
          {!shift ? (
            <p className="mt-2 text-sm text-ink-2">No open shift.</p>
          ) : (
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt>Orders</dt>
                <dd className="tabular-nums">{shift.orders}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Cash orders</dt>
                <dd className="tabular-nums">{shift.cashOrders}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Cash collected</dt>
                <dd className="tabular-nums">₹{shift.cashCollected}</dd>
              </div>
              <div className="flex justify-between font-medium">
                <dt>Expected drawer</dt>
                <dd className="tabular-nums">₹{shift.expectedDrawer}</dd>
              </div>
            </dl>
          )}
        </Card>

        {lastCompleted && permissions.includes('pos:refund:process') && (
          <Card>
            <h2 className="text-sm font-medium text-ink-2">Refund last sale</h2>
            <p className="mt-1 truncate font-mono text-xs text-ink-2">{lastCompleted}</p>
            <Input
              className="mt-2"
              placeholder="Reason"
              value={refundReason}
              onChange={(event) => setRefundReason(event.target.value)}
            />
            <Button
              className="mt-2 w-full"
              variant="danger"
              size="sm"
              disabled={requestRefund.isPending || refundReason.length < 3}
              onClick={() => requestRefund.mutate()}
            >
              Request refund
            </Button>
          </Card>
        )}

        {permissions.includes('pos:refund:process') && pending.length > 0 && (
          <Card>
            <h2 className="text-sm font-medium text-ink-2">Pending refunds</h2>
            <ul className="mt-2 divide-y divide-line">
              {pending.map((r) => (
                <li key={r.refundId} className="py-2 text-sm">
                  <p className="font-medium">
                    ₹{r.amount} · {r.orderId.slice(0, 8)}…
                  </p>
                  <p className="text-xs text-ink-2">{r.reason}</p>
                  {permissions.includes('orders:refund:approve') && (
                    <Button
                      className="mt-1"
                      size="sm"
                      variant="secondary"
                      onClick={() => approveRefund.mutate(r.refundId)}
                      disabled={approveRefund.isPending}
                    >
                      Approve (returns stock)
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function WedgeSearchInput({
  sessionId,
  onAdd,
}: {
  sessionId: string;
  onAdd: (name: string) => void;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PosItem[]>([]);
  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void posSearch(sessionId, term.trim())
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [term, sessionId]);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <Input
        type="search"
        placeholder="Search product name / SKU / barcode…"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        aria-label="Search products"
      />
      {results.length > 0 && (
        <ul className="mt-2 divide-y divide-line">
          {results.map((product) => (
            <li key={product.productId} className="flex items-center justify-between py-2">
              <span className="text-sm">
                {product.name}
                <span className="ml-2 text-xs text-ink-2">₹{product.unitPrice}</span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={product.availableStock === '0.000'}
                onClick={() => {
                  void posScan(sessionId, product.barcode ?? '').then(() => {
                    onAdd(product.name);
                    setTerm('');
                    setResults([]);
                  });
                }}
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function incQty(item: PosItem): string {
  return (Number(item.quantity) + (item.isWeighed ? 0.5 : 1)).toFixed(3);
}

function decQty(item: PosItem): string {
  const next = item.isWeighed ? Number(item.quantity) - 0.5 : Number(item.quantity) - 1;
  return Math.max(item.isWeighed ? 0.001 : 1, next).toFixed(3);
}
