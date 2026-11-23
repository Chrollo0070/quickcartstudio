'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Search, ShoppingBasket } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelSession,
  confirmCart,
  attachCustomer,
  createSession,
  createIntent,
  fetchReceipt,
  getSession,
  mockSettlePayment,
  type Receipt,
  quoteCart,
  removeItem,
  scan,
  searchProducts,
  updateQuantity,
  type ApiProblem,
  type CartItem,
  type CartQuote,
  type CheckoutSession,
  type ScanResult,
  type SearchProduct,
} from '@/lib/checkout-client';
import { fetchBranches } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type Phase = 'pick-branch' | 'shopping' | 'payment' | 'receipt' | 'cancelled';

const SESSION_STORAGE_KEY = 'quickcart.checkout-session';
const SCAN_COOLDOWN_MS = 1_200;

/**
 * Customer self-checkout (spec §5): scan → server adds + reserves →
 * server-quoted totals → confirm (payment settles in Phase 3).
 * The camera starts only after the customer taps "Start scanning".
 */
export default function ShopPage() {
  const [phase, setPhase] = useState<Phase>('pick-branch');
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [branchName, setBranchName] = useState<string>('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderTotal, setOrderTotal] = useState<string | null>(null);

  // Restore an in-flight session after a reload (possession token only).
  useEffect(() => {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (stored) {
      try {
        const restored = JSON.parse(stored) as CheckoutSession;
        setSession(restored);
        setPhase('shopping');
      } catch {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  }, []);

  const branchesQuery = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });

  const startMutation = useMutation({
    mutationFn: createSession,
    onSuccess: (created, branchId) => {
      const branch = branchesQuery.data?.find((b) => b.id === branchId);
      setBranchName(branch?.name ?? 'QuickMart');
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(created));
      setSession(created);
      setPhase('shopping');
    },
  });

  if (phase === 'pick-branch' || !session) {
    return (
      <div className="flex flex-1 flex-col gap-6 pb-16 pt-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Self-checkout</h1>
          <p className="mt-1 text-sm text-ink-2">
            Scan items with your phone camera, watch totals live, pay at the end. Demo store, no
            real payment.
          </p>
        </div>
        <Card>
          <h2 className="text-sm font-medium text-ink-2">Choose your store</h2>
          {branchesQuery.isPending && <p className="mt-4 text-sm text-ink-2">Loading stores…</p>}
          <div className="mt-4 flex flex-col gap-2">
            {branchesQuery.data?.map((branch) => (
              <button
                key={branch.id}
                className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-left hover:border-emerald-600 hover:bg-accent-soft"
                onClick={() => startMutation.mutate(branch.id)}
                disabled={startMutation.isPending}
              >
                <span>
                  <span className="block font-medium text-ink">{branch.name}</span>
                  <span className="block text-xs text-ink-2">
                    {branch.city ?? '—'} · {branch.code}
                  </span>
                </span>
                <span className="text-sm font-medium text-accent">Start →</span>
              </button>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (phase === 'payment' && session && orderId) {
    return (
      <PaymentView
        session={session}
        orderId={orderId}
        orderTotal={orderTotal ?? '0.00'}
        onSettled={() => {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
          setPhase('receipt');
        }}
      />
    );
  }

  if (phase === 'receipt' && session && orderId) {
    return <ReceiptView session={session} orderId={orderId} />;
  }

  if (phase === 'cancelled') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Session cancelled</h1>
        <p className="text-sm text-ink-2">All reserved stock was released.</p>
        <Button
          onClick={() => {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
            setSession(null);
            setPhase('pick-branch');
          }}
        >
          Start a new cart
        </Button>
      </div>
    );
  }

  return (
    <ShoppingView
      session={session}
      branchName={branchName}
      onDone={(orderIdValue, total) => {
        setOrderId(orderIdValue);
        setOrderTotal(total);
        setPhase('payment');
      }}
      onCancelled={() => {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        setPhase('cancelled');
      }}
      onAbandoned={() => {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
        setSession(null);
        setPhase('pick-branch');
      }}
    />
  );
}

function ShoppingView({
  session,
  branchName,
  onDone,
  onCancelled,
  onAbandoned,
}: {
  session: CheckoutSession;
  branchName: string;
  onDone: (orderId: string, total: string) => void;
  onCancelled: () => void;
  onAbandoned: () => void;
}) {
  const [scanFeedback, setScanFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [loyaltyPhone, setLoyaltyPhone] = useState('');
  const [loyaltyPoints, setLoyaltyPoints] = useState('');
  const [appliedPoints, setAppliedPoints] = useState(0);
  const [lastScan, setLastScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const sessionQuery = useQuery({
    queryKey: ['shop-session', session.sessionId],
    queryFn: () => getSession(session),
    refetchInterval: 60_000,
  });

  const quoteQuery = useQuery({
    queryKey: ['shop-quote', session.sessionId, appliedCoupon],
    queryFn: () => quoteCart(session, appliedCoupon ?? undefined, appliedPoints || undefined),
    enabled: (sessionQuery.data?.items.length ?? 0) > 0,
  });

  // Invalidate (not key-swap): the same query key refetches and React Query
  // updates the cache in place — mutations always render fresh server state.
  const bump = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['shop-session'] });
    void queryClient.invalidateQueries({ queryKey: ['shop-quote'] });
  }, [queryClient]);

  const handleBarcode = useCallback(
    async (code: string) => {
      const now = Date.now();
      if (code === lastScanRef.current.code && now - lastScanRef.current.at < SCAN_COOLDOWN_MS) {
        return; // debounce duplicate decodes of the same physical scan
      }
      lastScanRef.current = { code, at: now };
      try {
        const result = await scan(session, code);
        setLastScan(result);
        setScanFeedback({ ok: true, text: `${result.name} added` });
        bump();
      } catch (error) {
        const problem = error as ApiProblem;
        const messages: Record<string, string> = {
          PRODUCT_UNAVAILABLE: 'Not sold at this branch',
          OUT_OF_STOCK: 'No stock left for this item',
          SESSION_EXPIRED: 'Session expired — start a new cart',
        };
        // Unknown barcodes echo the scanned digits so the operator can
        // register the real-world product in the catalogue.
        setScanFeedback({
          ok: false,
          text:
            messages[problem.code ?? ''] ??
            (problem.code === 'PRODUCT_NOT_FOUND'
              ? `Unknown barcode ${code} — not in this catalogue. Try the search below, or register it (Swagger: POST /products).`
              : (problem.message ?? 'Scan failed')),
        });
        if (problem.code === 'SESSION_EXPIRED') onAbandoned();
      }
    },
    [session, onAbandoned],
  );

  const scannerMutation = useMutation({
    mutationFn: async () => {
      // Browsers grant getUserMedia only on HTTPS or localhost — on a plain
      // http:// LAN address Chrome blocks the camera WITHOUT prompting, so
      // say so explicitly instead of a generic failure.
      if (!window.isSecureContext) {
        throw new Error(
          'Camera needs HTTPS or localhost — Chrome blocks it on this http:// address. On Android: chrome://flags → "Insecure origins treated as secure" → add ' +
            window.location.origin +
            ' → relaunch. Or use the search below.',
        );
      }
      const reader = new BrowserMultiFormatReader();
      return new Promise<void>((resolve, reject) => {
        reader
          .decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
            if (result) void handleBarcode(result.getText());
          })
          .then((controls) => {
            controlsRef.current = controls;
            setScanning(true);
            resolve();
          })
          .catch(reject);
      });
    },
    onError: (error) => {
      const name = (error as { name?: string }).name;
      const messages: Record<string, string> = {
        NotAllowedError:
          'Camera permission was denied — tap the ⊙ icon next to the address → Permissions → Camera → Allow, then retry.',
        NotFoundError: 'No camera was found on this device.',
      };
      setScanFeedback({
        ok: false,
        text: messages[name ?? ''] ?? (error as Error).message ?? 'Camera unavailable',
      });
    },
  });

  const stopScanner = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setScanning(false);
  }, []);

  useEffect(() => stopScanner, [stopScanner]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const searchQuery = useQuery({
    queryKey: ['shop-search', session.sessionId, debouncedSearch],
    queryFn: () => searchProducts(session, debouncedSearch),
    enabled: debouncedSearch.length > 1,
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmCart(session, crypto.randomUUID(), quoteQuery.data?.quote.hash),
    onSuccess: (result) => onDone(result.orderId, quoteQuery.data?.quote.grandTotal ?? '0.00'),
    onError: (error) => {
      const problem = error as ApiProblem;
      if (problem.code === 'CART_STALE') {
        bump(); // fresh quote refetches; ask the customer to confirm again
        setScanFeedback({ ok: false, text: 'Prices changed — review and confirm again' });
      } else if (problem.code === 'SESSION_EXPIRED') {
        onAbandoned();
      } else {
        setScanFeedback({ ok: false, text: problem.message ?? 'Checkout failed' });
      }
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelSession(session),
    onSuccess: () => {
      stopScanner();
      onCancelled();
    },
  });

  const items = sessionQuery.data?.items ?? [];
  // Badge shows total units (weighted goods add fractional units), not the
  // distinct-item count — that is what a shopper expects the count to mean.
  const totalUnits = items.reduce((sum, item) => sum + Number(item.quantity), 0);
  const badgeUnits = parseFloat(totalUnits.toFixed(3)).toString();
  const quote: CartQuote | undefined = quoteQuery.data?.quote;

  return (
    <div className="flex flex-1 flex-col gap-6 pb-16 pt-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{branchName}</h1>
          <p className="text-sm text-ink-2">
            Session expires{' '}
            {sessionQuery.data ? new Date(sessionQuery.data.expiresAt).toLocaleTimeString() : '…'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => cancelMutation.mutate()}
          disabled={cancelMutation.isPending}
        >
          Cancel cart
        </Button>
      </div>

      {/* Scanner */}
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink-2">Scanner</h2>
        </div>
        {scannerMutation.isPending ? (
          <div className="mt-3 flex h-[72px] items-center gap-4 rounded-xl border border-line bg-raised px-4">
            <ScanGlyph />
            <p className="flex-1 text-sm text-ink-2">Starting camera…</p>
            <Button variant="ghost" size="sm" onClick={stopScanner}>
              Cancel
            </Button>
          </div>
        ) : scanning ? (
          <div className="relative mt-3 overflow-hidden rounded-xl bg-ink">
            <video ref={videoRef} className="h-56 w-full object-cover" muted playsInline />
            {/* The sweep explains that scanning is live; transform-only motion */}
            <div
              className="scan-sweep pointer-events-none absolute inset-x-6 h-[2px] rounded-full bg-accent"
              aria-hidden
            />
            <Button
              variant="secondary"
              size="sm"
              className="absolute right-3 top-3"
              onClick={stopScanner}
            >
              Stop
            </Button>
          </div>
        ) : (
          <div className="mt-3 rounded-xl bg-raised p-4 sm:flex sm:h-[72px] sm:items-center sm:gap-4 sm:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-4">
              <ScanGlyph />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">Camera is off</p>
                <p className="text-[13px] text-ink-3">
                  Scanning starts on request — search works meanwhile
                </p>
              </div>
            </div>
            <Button size="sm" className="w-full sm:w-auto" onClick={() => scannerMutation.mutate()}>
              Start scanning
            </Button>
          </div>
        )}
        {scanFeedback && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-sm ring-1 ring-inset ${
              scanFeedback.ok
                ? 'bg-accent-soft text-accent ring-accent/20'
                : 'bg-[#fef2f2] text-[#b91c1c] ring-[#dc2626]/20'
            }`}
            role="status"
          >
            {scanFeedback.text}
          </p>
        )}
        {lastScan && (
          <p className="mt-2 text-xs text-ink-3">
            Last scan: {lastScan.name} · {lastScan.quantity}
          </p>
        )}
        <div className="mt-4">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3"
              aria-hidden
            />
            <Input
              type="search"
              placeholder="Search products"
              className="h-10 pl-9"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              aria-label="Search products"
            />
          </div>
          {searchQuery.data && searchQuery.data.length > 0 && (
            <ul className="mt-2 divide-y divide-line">
              {searchQuery.data.map((product: SearchProduct) => (
                <li key={product.productId} className="flex items-center justify-between py-2">
                  <span>
                    <span className="block text-sm font-medium text-ink">{product.name}</span>
                    <span className="block text-xs text-ink-2">
                      ₹{product.unitPrice} · {product.availableStock} available
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void handleBarcode(product.barcode);
                      setSearchTerm('');
                      setDebouncedSearch('');
                    }}
                    disabled={product.availableStock === '0.000'}
                  >
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {/* Cart */}
      <Card>
        <div className="flex items-center gap-2">
          <h2 className="text-[15px] font-medium text-ink">Cart</h2>
          <span
            data-testid="cart-count"
            className="rounded-md bg-raised px-2 py-0.5 font-mono text-xs text-ink-2"
          >
            {badgeUnits}
          </span>
        </div>
        {sessionQuery.isPending && <p className="mt-3 text-sm text-ink-2">Loading cart…</p>}
        {items.length === 0 && !sessionQuery.isPending && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ShoppingBasket className="size-8 text-ink-3" strokeWidth={1.5} aria-hidden />
            <p className="text-sm text-ink-2">
              Nothing scanned yet — scan with the camera, or search below
            </p>
          </div>
        )}
        <ul className="mt-3 divide-y divide-line">
          {items.map((item) => (
            <li key={item.itemId} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">{item.name}</span>
                <span className="block text-xs text-ink-2">
                  ₹{item.unitPrice} / {item.unit}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Decrease ${item.name}`}
                  onClick={() =>
                    updateQuantity(session, item.itemId, decrementQty(item)).then(bump)
                  }
                >
                  −
                </Button>
                {item.isWeighed ? (
                  <Input
                    className="h-8 w-20 text-center"
                    defaultValue={item.quantity}
                    aria-label={`Weight for ${item.name}`}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value !== item.quantity && /^\d{1,6}\.\d{3}$/.test(value)) {
                        updateQuantity(session, item.itemId, value).then(bump);
                      }
                    }}
                  />
                ) : (
                  <span className="w-8 text-center text-sm font-medium tabular-nums">
                    {Number(item.quantity)}
                  </span>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Increase ${item.name}`}
                  onClick={() =>
                    updateQuantity(session, item.itemId, incrementQty(item))
                      .then(bump)
                      .catch((error: ApiProblem) =>
                        setScanFeedback({
                          ok: false,
                          text: error.code === 'OUT_OF_STOCK' ? 'No more stock' : error.message,
                        }),
                      )
                  }
                >
                  +
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => removeItem(session, item.itemId).then(bump)}
                >
                  ✕
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Totals */}
      {quote && (
        <Card className="sticky bottom-4 border-accent/20">
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between text-ink-2">
              <span>Subtotal</span>
              <span className="tabular-nums">₹{quote.subtotal}</span>
            </div>
            {Number(quote.itemDiscountTotal) > 0 && (
              <div className="flex justify-between text-accent">
                <span>Discounts</span>
                <span className="tabular-nums">−₹{quote.itemDiscountTotal}</span>
              </div>
            )}
            {quote.couponApplied && (
              <div className="flex justify-between text-accent">
                <span>Coupon {quote.couponApplied.code}</span>
                <span className="tabular-nums">−₹{quote.couponApplied.discount}</span>
              </div>
            )}
            <div className="flex justify-between text-ink-2">
              <span>GST ({quote.lines[0]?.taxSplit === 'IGST' ? 'IGST' : 'CGST+SGST'})</span>
              <span className="tabular-nums">₹{quote.taxTotal}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold text-ink">
              <span>Total</span>
              <span className="tabular-nums">₹{quote.grandTotal}</span>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              placeholder="Loyalty phone (try +919845000001)"
              value={loyaltyPhone}
              onChange={(event) => setLoyaltyPhone(event.target.value)}
              aria-label="Loyalty phone"
            />
            <Button
              variant="secondary"
              onClick={() => {
                if (loyaltyPhone) {
                  void attachCustomer(session, loyaltyPhone).then((r) =>
                    setScanFeedback({ ok: true, text: `${r.name} · ${r.loyaltyPoints} points` }),
                  );
                }
              }}
              disabled={!loyaltyPhone}
            >
              Attach
            </Button>
            <Input
              placeholder="Points"
              value={loyaltyPoints}
              onChange={(event) => setLoyaltyPoints(event.target.value.replace(/[^0-9]/g, ''))}
              aria-label="Loyalty points"
              className="w-24"
            />
            <Button
              variant="secondary"
              disabled={!loyaltyPoints}
              onClick={() => {
                setAppliedPoints(Number(loyaltyPoints));
                bump();
              }}
            >
              Redeem
            </Button>
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              placeholder="Coupon code (try WELCOME10)"
              value={couponCode}
              onChange={(event) => setCouponCode(event.target.value.toUpperCase())}
              aria-label="Coupon code"
            />
            <Button
              variant="secondary"
              onClick={() => {
                setAppliedCoupon(couponCode || null);
                bump();
              }}
              disabled={!couponCode}
            >
              Apply
            </Button>
          </div>
          {quote.couponError && (
            <p className="mt-2 text-xs text-[#a16207]">
              Coupon not applied ({quote.couponError.replace('COUPON_', '').toLowerCase()}).
            </p>
          )}
          <Button
            className="mt-4 w-full"
            size="lg"
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending || items.length === 0}
          >
            {confirmMutation.isPending ? 'Creating order…' : `Checkout · ₹${quote.grandTotal}`}
          </Button>
        </Card>
      )}
    </div>
  );
}

function incrementQty(item: CartItem): string {
  const step = item.isWeighed ? 0.5 : 1;
  return (Number(item.quantity) + step).toFixed(3);
}

function decrementQty(item: CartItem): string {
  // Pieces never drop below 1 via −; removing the item is a separate action.
  const next = item.isWeighed ? Number(item.quantity) - 0.5 : Number(item.quantity) - 1;
  return Math.max(item.isWeighed ? 0.001 : 1, next).toFixed(3);
}

function PaymentView({
  session,
  orderId,
  orderTotal,
  onSettled,
}: {
  session: CheckoutSession;
  orderId: string;
  orderTotal: string;
  onSettled: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  const payMutation = useMutation({
    mutationFn: async () => {
      const intent = await createIntent(session, orderId, crypto.randomUUID());
      await mockSettlePayment(session, intent.paymentId);
    },
    onSuccess: onSettled,
    onError: (mutationError) => setError((mutationError as ApiProblem).message ?? 'Payment failed'),
  });

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 pb-16 text-center">
      <div>
        <p className="text-sm font-medium text-ink-2">Order {orderId.slice(0, 8)}…</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">₹{orderTotal}</h1>
        <p className="mt-2 text-sm text-ink-2">
          Demo payment — the server emits the signed mock callback and settles through the same
          verified path a real provider uses. No card data involved.
        </p>
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-[#b91c1c] ring-1 ring-inset ring-red-600/20">
          {error}
        </p>
      )}
      <Button size="lg" onClick={() => payMutation.mutate()} disabled={payMutation.isPending}>
        {payMutation.isPending ? 'Settling…' : 'Pay now (demo)'}
      </Button>
    </div>
  );
}

function ReceiptView({ session, orderId }: { session: CheckoutSession; orderId: string }) {
  const receiptQuery = useQuery({
    queryKey: ['shop-receipt', orderId],
    queryFn: () => fetchReceipt(session, orderId),
  });

  if (receiptQuery.isPending) {
    return (
      <p className="flex flex-1 items-center justify-center text-sm text-ink-2">
        Printing receipt…
      </p>
    );
  }
  if (receiptQuery.isError || !receiptQuery.data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 pb-16 text-center">
        <p className="text-sm text-[#b91c1c]">Receipt unavailable.</p>
        <Link href="/shop" className="text-sm font-medium text-accent">
          New cart
        </Link>
      </div>
    );
  }

  const receipt: Receipt = receiptQuery.data;
  const payload = receipt.payload;
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 pb-16 pt-4">
      <div className="rounded-2xl border border-line bg-card p-6 font-mono text-[13px] shadow-sm">
        <p className="text-center font-semibold">{payload.store.name}</p>
        <p className="text-center text-ink-2">
          {payload.store.city} · GSTIN {payload.store.gstin}
        </p>
        <p className="mt-3 text-center text-ink-2">
          {receipt.invoiceNumber} · {new Date(receipt.issuedAt).toLocaleString()}
        </p>
        <div className="receipt-tear my-3" />
        {payload.lines.map((line) => (
          <div key={line.name + line.quantity} className="flex justify-between py-0.5">
            <span className="truncate pr-2">
              {line.name} × {Number(line.quantity)}
            </span>
            <span className="tabular-nums">{line.lineTotal}</span>
          </div>
        ))}
        <div className="receipt-tear my-3" />
        <div className="flex justify-between py-0.5 text-ink-2">
          <span>Subtotal</span>
          <span className="tabular-nums">{payload.totals.subtotal}</span>
        </div>
        {Number(payload.totals.couponDiscountTotal) > 0 && (
          <div className="flex justify-between py-0.5 text-accent">
            <span>Coupon</span>
            <span className="tabular-nums">−{payload.totals.couponDiscountTotal}</span>
          </div>
        )}
        <div className="flex justify-between py-0.5 text-ink-2">
          <span>GST (CGST+SGST)</span>
          <span className="tabular-nums">{payload.totals.taxTotal}</span>
        </div>
        <div className="mt-2 flex justify-between border-t border-dashed border-zinc-300 pt-2 text-base font-semibold">
          <span>TOTAL</span>
          <span className="tabular-nums">₹{payload.totals.grandTotal}</span>
        </div>
        <p className="mt-3 text-center text-ink-3">
          Paid via {payload.payment.provider} · {payload.payment.currency} {payload.payment.amount}
        </p>
      </div>
      <Link href="/shop" className="text-center text-sm font-medium text-accent hover:text-ink">
        Start a new cart
      </Link>
    </div>
  );
}

function ScanGlyph() {
  return (
    <span
      className="flex h-10 w-10 shrink-0 flex-col justify-between rounded-lg bg-ink p-2"
      aria-hidden
    >
      <span className="h-[3px] w-full rounded-full bg-card" />
      <span className="h-[3px] w-full rounded-full bg-accent" />
      <span className="h-[3px] w-full rounded-full bg-card" />
    </span>
  );
}
