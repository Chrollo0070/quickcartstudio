'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Search, Vault } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  calculateTenderChange,
  formatThermalText,
  formatZReportText,
  QUICK_SCAN_ITEMS,
  suggestCashDenominations,
  type ThermalSlipInput,
} from '@/lib/desktop-receipt';
import {
  listPosSessions,
  openPosSession,
  posCloseShift,
  posComplete,
  posCurrentShift,
  posGetSession,
  posOpenShift,
  posQuote,
  posRemoveItem,
  posResume,
  posScan,
  posSearch,
  posSuspend,
  posUpdateQty,
  type CartView,
  type PosItem,
  type ShiftZReport,
} from '@/lib/pos-client';

interface QuoteState {
  grandTotal: string;
  taxTotal: string;
  subtotal: string;
  hash: string;
}

function formatSignedInr(value: string | number): string {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '₹0.00';
  return `${num > 0 ? '+' : '-'}₹${Math.abs(num).toFixed(2)}`;
}

export function DesktopRegisterView({
  incomingBarcode,
  onBarcodeConsumed,
  onReceiptCreated,
  onPrintSlip,
  onKickDrawer,
  registerShortcutsRef,
}: {
  incomingBarcode: { code: string; seq: number } | null;
  onBarcodeConsumed: () => void;
  onReceiptCreated: (slip: ThermalSlipInput) => void;
  onPrintSlip: (slip: ThermalSlipInput, paperWidth: 42 | 32, silent: boolean) => void;
  onKickDrawer: () => void;
  registerShortcutsRef: React.MutableRefObject<{
    newSale: () => void;
    focusSearch: () => void;
    parkSale: () => void;
    cashCheckout: () => void;
    reprintLast: () => void;
  }>;
}) {
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const pendingSessionRef = useRef<Promise<string> | null>(null);
  const [session, setSession] = useState<CartView | null>(null);
  const [quote, setQuote] = useState<QuoteState | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<PosItem[]>([]);
  const [cashTendered, setCashTendered] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastSlip, setLastSlip] = useState<ThermalSlipInput | null>(null);
  const [closingShiftOpen, setClosingShiftOpen] = useState(false);
  const [countedCashInput, setCountedCashInput] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [openingFloatInput, setOpeningFloatInput] = useState('2000.00');
  const [lastZReport, setLastZReport] = useState<ShiftZReport | null>(null);

  const shiftQuery = useQuery({ queryKey: ['desktop-pos-shift'], queryFn: posCurrentShift });
  const parkedQuery = useQuery({ queryKey: ['desktop-pos-parked'], queryFn: listPosSessions });

  const refreshCart = useCallback(
    async (sessionId: string) => {
      const updated = await posGetSession(sessionId);
      activeSessionIdRef.current = updated.id;
      setSession(updated);
      if (updated.items.length > 0) {
        const quoted = await posQuote(sessionId);
        setQuote(quoted.quote);
      } else {
        setQuote(null);
      }
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-shift'] });
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-parked'] });
    },
    [queryClient],
  );

  const ensureSession = useCallback(async (): Promise<string> => {
    if (activeSessionIdRef.current) return activeSessionIdRef.current;
    if (session) {
      activeSessionIdRef.current = session.id;
      return session.id;
    }
    if (pendingSessionRef.current) return pendingSessionRef.current;
    const creation = (async () => {
      const created = await openPosSession();
      activeSessionIdRef.current = created.sessionId;
      const cart = await posGetSession(created.sessionId);
      setSession(cart);
      return created.sessionId;
    })().finally(() => {
      pendingSessionRef.current = null;
    });
    pendingSessionRef.current = creation;
    return creation;
  }, [session]);

  const handleScanBarcode = useCallback(
    async (barcode: string) => {
      const trimmed = barcode.trim();
      if (!trimmed) return;
      try {
        const sid = await ensureSession();
        const item = await posScan(sid, trimmed);
        setStatusMessage({ ok: true, text: `Scanned ${item.name} (qty ${Number(item.quantity)})` });
        await refreshCart(sid);
      } catch (err) {
        setStatusMessage({ ok: false, text: (err as Error).message });
      }
    },
    [ensureSession, refreshCart],
  );

  // Consume simulated USB scanner events from the Hardware tab
  useEffect(() => {
    if (!incomingBarcode) return;
    void handleScanBarcode(incomingBarcode.code).finally(onBarcodeConsumed);
  }, [incomingBarcode, handleScanBarcode, onBarcodeConsumed]);

  // Debounced product lookup while typing in the search/barcode box
  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const sid = session?.id ?? (await ensureSession());
          const found = await posSearch(sid, q);
          setSearchResults(found);
        } catch {
          setSearchResults([]);
        }
      })();
    }, 200);
    return () => clearTimeout(timer);
  }, [searchTerm, session?.id, ensureSession]);

  const newSaleMutation = useMutation({
    mutationFn: openPosSession,
    onSuccess: async (created) => {
      activeSessionIdRef.current = created.sessionId;
      const cart = await posGetSession(created.sessionId);
      setSession(cart);
      setQuote(null);
      setCashTendered('');
      setStatusMessage({ ok: true, text: 'Opened fresh register sale.' });
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-parked'] });
      setTimeout(() => searchInputRef.current?.focus(), 50);
    },
    onError: (err) => setStatusMessage({ ok: false, text: (err as Error).message }),
  });

  const suspendMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('No active cart to suspend');
      return posSuspend(session.id);
    },
    onSuccess: () => {
      activeSessionIdRef.current = null;
      setSession(null);
      setQuote(null);
      setCashTendered('');
      setStatusMessage({ ok: true, text: 'Sale parked — resume any time from Parked sales.' });
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-parked'] });
    },
    onError: (err) => setStatusMessage({ ok: false, text: (err as Error).message }),
  });

  const completeMutation = useMutation({
    mutationFn: async (method: 'CASH' | 'MOCK') => {
      if (!session || !quote) throw new Error('Add at least one item before checkout');
      const snapshotItems = [...session.items];
      const snapshotQuote = { ...quote };
      const grand = Number(snapshotQuote.grandTotal);
      const paidNum = cashTendered ? Number(cashTendered) : grand;
      if (method === 'CASH' && paidNum + 0.0001 < grand) {
        throw new Error(`Cash tendered is short by ₹${(grand - paidNum).toFixed(2)}`);
      }
      const res = await posComplete(session.id, method, crypto.randomUUID(), snapshotQuote.hash);
      const tenderSummary = calculateTenderChange(grand, paidNum);
      const slip: ThermalSlipInput = {
        invoiceNumber: res.receiptNumber ?? `QM-PAN-${res.orderId.slice(0, 6).toUpperCase()}`,
        issuedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        storeName: 'QuickMart Panaji',
        storeAddress: '18 June Road, Panaji',
        gstin: '30ABCDE1234F1Z5',
        lines: snapshotItems.map((item) => ({
          name: item.name,
          quantity: String(Number(item.quantity)),
          unitPrice: item.unitPrice,
          lineTotal: (Number(item.unitPrice) * Number(item.quantity)).toFixed(2),
        })),
        subtotal: snapshotQuote.subtotal,
        taxTotal: snapshotQuote.taxTotal,
        grandTotal: snapshotQuote.grandTotal,
        paymentMethod: method === 'CASH' ? 'CASH' : 'CARD (DEMO)',
        tendered: method === 'CASH' ? paidNum.toFixed(2) : undefined,
        changeDue: method === 'CASH' ? tenderSummary.changeDue : undefined,
      };
      return { res, slip, method };
    },
    onSuccess: ({ res, slip, method }) => {
      activeSessionIdRef.current = null;
      setSession(null);
      setQuote(null);
      setCashTendered('');
      setLastSlip(slip);
      onReceiptCreated(slip);
      if (method === 'CASH') {
        onKickDrawer();
      }
      setStatusMessage({
        ok: true,
        text: `Sale completed · Receipt ${res.receiptNumber ?? slip.invoiceNumber}`,
      });
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-shift'] });
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-parked'] });
      void queryClient.invalidateQueries({ queryKey: ['desktop-inventory'] });
    },
    onError: (err) => setStatusMessage({ ok: false, text: (err as Error).message }),
  });

  const closeShiftMutation = useMutation({
    mutationFn: () =>
      posCloseShift(countedCashInput || shiftQuery.data?.shift?.expectedDrawer || '0.00', closeNotes),
    onSuccess: (result) => {
      setClosingShiftOpen(false);
      setCloseNotes('');
      if (result.zReport) {
        setLastZReport(result.zReport);
        setStatusMessage({
          ok: true,
          text: `Shift closed · Z-Report ${result.zReport.reportNumber} (variance ${formatSignedInr(result.zReport.variance)})`,
        });
      } else {
        setStatusMessage({ ok: true, text: 'Shift closed.' });
      }
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-shift'] });
    },
    onError: (err) => setStatusMessage({ ok: false, text: (err as Error).message }),
  });

  const openShiftMutation = useMutation({
    mutationFn: () => posOpenShift(openingFloatInput || '2000.00'),
    onSuccess: () => {
      setStatusMessage({
        ok: true,
        text: `Opened new shift with ₹${Number(openingFloatInput || 2000).toFixed(2)} drawer float.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-shift'] });
    },
    onError: (err) => setStatusMessage({ ok: false, text: (err as Error).message }),
  });

  // Wire keyboard shortcuts to latest handlers
  registerShortcutsRef.current = {
    newSale: () => newSaleMutation.mutate(),
    focusSearch: () => searchInputRef.current?.focus(),
    parkSale: () => {
      if (session) suspendMutation.mutate();
    },
    cashCheckout: () => {
      if (session && quote && !completeMutation.isPending) completeMutation.mutate('CASH');
    },
    reprintLast: () => {
      if (lastSlip) onPrintSlip(lastSlip, 42, true);
    },
  };

  const grandTotalNum = quote ? Number(quote.grandTotal) : 0;
  const tenderedNum = cashTendered ? Number(cashTendered) : grandTotalNum;
  const tenderCalc = calculateTenderChange(grandTotalNum, tenderedNum);
  const denominations = suggestCashDenominations(grandTotalNum);
  const shift = shiftQuery.data?.shift;
  const parked = (parkedQuery.data ?? []).filter((p) => p.id !== session?.id);

  return (
    <div data-testid="desktop-register-view" className="grid gap-6 lg:grid-cols-[1.45fr_0.95fr]">
      {/* Left Column: Barcode/Search Entry, Quick Shelf, Cart Ledger */}
      <div className="flex flex-col gap-5">
        <section className="rounded-xl border border-line bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">Lane 01 · Active basket</h2>
              <p className="mt-0.5 text-xs text-ink-2">
                Type an EAN-13 barcode + Enter, search by product name, or click a quick-scan staple.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {session ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="whitespace-nowrap"
                  disabled={suspendMutation.isPending}
                  onClick={() => suspendMutation.mutate()}
                >
                  Park sale (F4)
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="whitespace-nowrap"
                  disabled={newSaleMutation.isPending}
                  onClick={() => newSaleMutation.mutate()}
                >
                  New sale (F1)
                </Button>
              )}
            </div>
          </div>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const value = searchTerm.trim();
              if (!value) return;
              if (/^\d{8,14}$/.test(value)) {
                void handleScanBarcode(value);
                setSearchTerm('');
                setSearchResults([]);
              } else if (searchResults[0]?.barcode) {
                void handleScanBarcode(searchResults[0].barcode);
                setSearchTerm('');
                setSearchResults([]);
              }
            }}
          >
            <div className="relative flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
                aria-hidden
              />
              <Input
                ref={searchInputRef}
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Scan EAN-13 barcode or search catalogue (F2)…"
                aria-label="Desktop barcode or product search"
                className="pl-9"
              />
            </div>
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>

          {searchResults.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-paper">
              {searchResults.slice(0, 5).map((item) => (
                <li
                  key={item.productId}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-ink">{item.name}</span>
                    <span className="ml-2 font-mono text-xs text-ink-2">₹{item.unitPrice}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (item.barcode) void handleScanBarcode(item.barcode);
                      setSearchTerm('');
                      setSearchResults([]);
                    }}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* Quick-scan staples */}
          <div className="mt-4">
            <p className="text-xs font-medium text-ink-2">Quick-scan counter staples</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {QUICK_SCAN_ITEMS.map((item) => (
                <button
                  key={item.barcode}
                  type="button"
                  onClick={() => void handleScanBarcode(item.barcode)}
                  className="rounded-lg border border-line bg-paper px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent-soft"
                >
                  <span className="block truncate text-xs font-medium text-ink">{item.name}</span>
                  <span className="mt-0.5 flex items-center justify-between text-[11px] text-ink-2 tabular-nums">
                    <span>₹{item.price}</span>
                    <span>GST {item.gst}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          {statusMessage && (
            <p
              role="status"
              className={`mt-4 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
                statusMessage.ok
                  ? 'bg-accent-soft text-accent ring-accent/20'
                  : 'bg-[#fef2f2] text-[#b91c1c] ring-[#dc2626]/20'
              }`}
            >
              {statusMessage.text}
            </p>
          )}
        </section>

        {/* Cart Line Items Table */}
        <section className="overflow-hidden rounded-xl border border-line bg-card">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h3 className="text-sm font-semibold text-ink">
              Cart items · {session?.items.length ?? 0} lines
            </h3>
            <span className="font-mono text-xs text-ink-3">
              {session ? `Session ${session.id.slice(0, 8)}` : 'Ready for next customer'}
            </span>
          </div>

          {!session || session.items.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium text-ink">No items scanned yet</p>
              <p className="mt-1 text-xs text-ink-2">
                Click any quick-scan staple above, scan a barcode, or press F1 to open a sale.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-ink-2">
                    <th className="px-4 py-2.5 font-medium">Item</th>
                    <th className="px-4 py-2.5 font-medium text-right">Rate</th>
                    <th className="px-4 py-2.5 font-medium text-center">Qty</th>
                    <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                    <th className="px-4 py-2.5 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {session.items.map((item) => {
                    const qty = Number(item.quantity);
                    const step = item.isWeighed ? 0.5 : 1;
                    const lineAmt = (Number(item.unitPrice) * qty).toFixed(2);
                    return (
                      <tr key={item.itemId} className="hover:bg-paper">
                        <td className="px-4 py-2.5">
                          <span className="block font-medium text-ink">{item.name}</span>
                          <span className="block font-mono text-[11px] text-ink-3">
                            {item.barcode ?? item.unit}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono tabular-nums text-ink-2">
                          ₹{item.unitPrice}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Decrease ${item.name}`}
                              onClick={() => {
                                const next = Math.max(item.isWeighed ? 0.5 : 1, qty - step);
                                void posUpdateQty(session.id, item.itemId, next.toFixed(3)).then(
                                  () => refreshCart(session.id),
                                );
                              }}
                            >
                              −
                            </Button>
                            <span className="w-9 text-center font-mono text-xs font-medium tabular-nums">
                              {qty}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Increase ${item.name}`}
                              onClick={() => {
                                const next = qty + step;
                                void posUpdateQty(session.id, item.itemId, next.toFixed(3))
                                  .then(() => refreshCart(session.id))
                                  .catch((err) =>
                                    setStatusMessage({ ok: false, text: (err as Error).message }),
                                  );
                              }}
                            >
                              +
                            </Button>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono font-medium tabular-nums text-ink">
                          ₹{lineAmt}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Remove ${item.name}`}
                            onClick={() =>
                              void posRemoveItem(session.id, item.itemId).then(() =>
                                refreshCart(session.id),
                              )
                            }
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {parked.length > 0 && (
          <section className="rounded-xl border border-line bg-card p-4">
            <h3 className="text-xs font-semibold text-ink-2">Parked sales ({parked.length})</h3>
            <ul className="mt-2 divide-y divide-line text-sm">
              {parked.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between py-2">
                  <span className="font-mono text-xs text-ink-2">
                    {entry.id.slice(0, 8)}… · {entry.status}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      const resumed = await posResume(entry.id);
                      activeSessionIdRef.current = resumed.id;
                      setSession(resumed);
                      await refreshCart(entry.id);
                    }}
                  >
                    Resume
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Right Column: Tender Settlement, Shift Drawer, Thermal Receipt Preview */}
      <div className="flex flex-col gap-5">
        <section className="rounded-xl border border-line bg-card p-5">
          <h2 className="text-base font-semibold text-ink">Settlement & cash tender</h2>
          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-ink-2">
              <dt>Subtotal</dt>
              <dd className="font-mono tabular-nums">₹{quote?.subtotal ?? '0.00'}</dd>
            </div>
            <div className="flex justify-between text-ink-2">
              <dt>GST (CGST + SGST)</dt>
              <dd className="font-mono tabular-nums">₹{quote?.taxTotal ?? '0.00'}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2.5 text-lg font-semibold text-ink">
              <dt>Grand total</dt>
              <dd data-testid="desktop-grand-total" className="font-mono tabular-nums">
                ₹{quote?.grandTotal ?? '0.00'}
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <label htmlFor="cash-tendered-input" className="block text-xs font-medium text-ink-2">
              Cash received (INR)
            </label>
            <Input
              id="cash-tendered-input"
              inputMode="decimal"
              placeholder={quote ? quote.grandTotal : '0.00'}
              value={cashTendered}
              onChange={(event) =>
                setCashTendered(event.target.value.replace(/[^0-9.]/g, ''))
              }
              className="mt-1.5 font-mono"
            />
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {denominations.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setCashTendered(amount.toFixed(2))}
                  className="rounded-lg border border-line bg-paper py-1.5 font-mono text-xs font-medium text-ink transition-colors hover:border-accent hover:bg-accent-soft tabular-nums"
                >
                  ₹{amount}
                </button>
              ))}
            </div>
          </div>

          {quote && (
            <div className="mt-3 flex items-center justify-between rounded-lg bg-raised px-3 py-2 text-sm">
              <span className="text-ink-2">
                {tenderCalc.valid ? 'Change due' : 'Balance remaining'}
              </span>
              <span
                data-testid="desktop-change-due"
                className={`font-mono font-semibold tabular-nums ${
                  tenderCalc.valid ? 'text-accent' : 'text-[#b91c1c]'
                }`}
              >
                ₹{tenderCalc.valid ? tenderCalc.changeDue : tenderCalc.shortfall}
              </span>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              size="lg"
              disabled={!quote || completeMutation.isPending || !tenderCalc.valid}
              onClick={() => completeMutation.mutate('CASH')}
            >
              {completeMutation.isPending ? 'Settling…' : 'Cash tender (F8)'}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              disabled={!quote || completeMutation.isPending}
              onClick={() => completeMutation.mutate('MOCK')}
            >
              Card / UPI (demo)
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink">Shift cash drawer</h3>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={onKickDrawer} className="gap-1.5">
                <Vault className="size-3.5" aria-hidden />
                Open drawer
              </Button>
              {shift && !closingShiftOpen && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setCountedCashInput(shift.expectedDrawer);
                    setClosingShiftOpen(true);
                  }}
                >
                  Close shift
                </Button>
              )}
            </div>
          </div>

          {shift ? (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-ink-2">Completed sales</dt>
                  <dd className="mt-0.5 font-mono text-base font-semibold tabular-nums text-ink">
                    {shift.orders}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-2">Expected drawer</dt>
                  <dd
                    data-testid="desktop-expected-drawer"
                    className="mt-0.5 font-mono text-base font-semibold tabular-nums text-ink"
                  >
                    ₹{shift.expectedDrawer}
                  </dd>
                </div>
              </dl>

              {closingShiftOpen && (
                <div
                  data-testid="shift-close-panel"
                  className="mt-4 rounded-lg border border-line bg-paper p-3.5"
                >
                  <p className="text-xs font-semibold text-ink">End-of-shift cash count (Z-Report)</p>
                  <div className="mt-2.5 space-y-2.5">
                    <div>
                      <label
                        htmlFor="counted-cash-input"
                        className="block text-[11px] font-medium text-ink-2"
                      >
                        Counted cash in drawer (INR)
                      </label>
                      <Input
                        id="counted-cash-input"
                        inputMode="decimal"
                        value={countedCashInput}
                        onChange={(event) =>
                          setCountedCashInput(event.target.value.replace(/[^0-9.]/g, ''))
                        }
                        className="mt-1 h-9 font-mono text-sm"
                      />
                    </div>
                    {(() => {
                      const expectedNum = Number(shift.expectedDrawer);
                      const countedNum = countedCashInput ? Number(countedCashInput) : expectedNum;
                      const diff = Math.round((countedNum - expectedNum) * 100) / 100;
                      return (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-ink-2">Drawer variance</span>
                          <span
                            data-testid="shift-close-variance"
                            className={`font-mono font-semibold tabular-nums ${
                              diff === 0
                                ? 'text-accent'
                                : diff < 0
                                  ? 'text-[#b91c1c]'
                                  : 'text-ink'
                            }`}
                          >
                            {diff === 0
                              ? '₹0.00 (Exact)'
                              : `${diff > 0 ? '+' : '-'}₹${Math.abs(diff).toFixed(2)}`}
                          </span>
                        </div>
                      );
                    })()}
                    <div>
                      <label
                        htmlFor="shift-notes-input"
                        className="block text-[11px] font-medium text-ink-2"
                      >
                        Handover note (optional)
                      </label>
                      <Input
                        id="shift-notes-input"
                        value={closeNotes}
                        onChange={(event) => setCloseNotes(event.target.value)}
                        placeholder="e.g. Evening lane handover"
                        className="mt-1 h-9 text-xs"
                      />
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={closeShiftMutation.isPending}
                        onClick={() => closeShiftMutation.mutate()}
                      >
                        {closeShiftMutation.isPending ? 'Closing…' : 'Issue Z-Report'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setClosingShiftOpen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="mt-3 space-y-2.5">
              <p className="text-xs text-ink-2">
                Shift closed. Enter an opening float to start the next lane shift.
              </p>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Opening cash float"
                  inputMode="decimal"
                  value={openingFloatInput}
                  onChange={(event) =>
                    setOpeningFloatInput(event.target.value.replace(/[^0-9.]/g, ''))
                  }
                  className="h-9 font-mono text-sm"
                />
                <Button
                  size="sm"
                  className="whitespace-nowrap"
                  disabled={openShiftMutation.isPending}
                  onClick={() => openShiftMutation.mutate()}
                >
                  Open shift
                </Button>
              </div>
            </div>
          )}
        </section>

        {lastZReport && (
          <section className="rounded-xl border border-line bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Last shift Z-Report</h3>
                <p className="font-mono text-xs text-ink-2">
                  {lastZReport.reportNumber} · Variance {formatSignedInr(lastZReport.variance)}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLastZReport(null)}
              >
                Dismiss
              </Button>
            </div>
            <pre
              data-testid="desktop-z-report"
              className="receipt mt-3 overflow-x-auto rounded-lg border border-line p-3 text-[11px] leading-relaxed text-ink"
            >
              {formatZReportText(
                {
                  ...lastZReport,
                  closedAt: new Date(lastZReport.closedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                },
                42,
              )}
            </pre>
          </section>
        )}

        {lastSlip && (
          <section className="rounded-xl border border-line bg-card p-5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-ink">Last thermal receipt</h3>
                <p className="font-mono text-xs text-ink-2">{lastSlip.invoiceNumber}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                className="gap-1.5"
                onClick={() => onPrintSlip(lastSlip, 42, true)}
              >
                <Printer className="size-3.5" aria-hidden />
                Print (F9)
              </Button>
            </div>
            <pre
              data-testid="desktop-last-receipt"
              className="receipt mt-3 overflow-x-auto rounded-lg border border-line p-3 text-[11px] leading-relaxed text-ink"
            >
              {formatThermalText(lastSlip, 42)}
            </pre>
          </section>
        )}
      </div>
    </div>
  );
}
