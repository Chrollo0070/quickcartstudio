'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes,
  Cpu,
  ExternalLink,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Package,
  ShoppingBasket,
  Square,
  Store,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import ShopPage from '@/app/shop/page';
import { Button } from '@/components/ui/button';
import { fetchHealth, fetchMe, login, logout } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { DRAWER_KICK_HEX, type ThermalSlipInput } from '@/lib/desktop-receipt';
import { DesktopExeView } from './desktop-exe-view';
import { DesktopHardwareView, type HardwareEvent } from './desktop-hardware-view';
import { DesktopRegisterView } from './desktop-register-view';
import { DesktopStockView } from './desktop-stock-view';

type DesktopSection = 'register' | 'kiosk' | 'stock' | 'hardware' | 'package';

interface QuickcartDesktopBridge {
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<{ isMaximized: boolean; isKiosk: boolean }>;
    setKiosk: (enabled: boolean) => Promise<{ isMaximized: boolean; isKiosk: boolean }>;
    close: () => Promise<void>;
  };
  runtime?: {
    getInfo: () => Promise<{
      version: string;
      electronVersion: string;
      dataFilePath?: string;
    }>;
  };
  printer: {
    list?: () => Promise<Array<{ name: string; displayName?: string; isDefault?: boolean }>>;
    printReceipt: (payload: ThermalSlipInput, deviceName?: string) => Promise<{ ok: boolean }>;
  };
  drawer: {
    open: () => Promise<{ ok: boolean; commandHex: string; timestamp: string }>;
  };
  shell?: {
    openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  };
}

declare global {
  interface Window {
    quickcartDesktop?: QuickcartDesktopBridge;
  }
}

const DEMO_OPERATORS = [
  { label: 'Cashier', email: 'cashier@quickmart.dev' },
  { label: 'Admin', email: 'admin@quickmart.dev' },
  { label: 'Manager', email: 'manager@quickmart.dev' },
  { label: 'Inventory', email: 'inventory@quickmart.dev' },
] as const;

const SECTION_META: Record<DesktopSection, { label: string; subtitle: string }> = {
  register: { label: 'POS Register', subtitle: 'Lane 01 · Keyboard & barcode terminal' },
  kiosk: { label: 'Self-Checkout Kiosk', subtitle: 'Customer fullscreen checkout mode' },
  stock: { label: 'Stockroom Ledger', subtitle: 'Live branch stock, low-stock & FEFO expiry' },
  hardware: { label: 'Hardware & Printer', subtitle: '80mm thermal slip, USB scanner & RJ-11 drawer' },
  package: { label: 'Windows .exe', subtitle: 'Electron installer, portable build & IPC contract' },
};

export function DesktopShell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setSession = useAuthStore((s) => s.setSession);
  const clearSession = useAuthStore((s) => s.clearSession);

  const [section, setSection] = useState<DesktopSection>('register');
  const [isMaximized, setIsMaximized] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isKiosk, setIsKiosk] = useState(false);
  const [isElectronRuntime, setIsElectronRuntime] = useState(false);
  const [dataFilePath, setDataFilePath] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<ThermalSlipInput | null>(null);
  const [hardwareEvents, setHardwareEvents] = useState<HardwareEvent[]>([]);
  const [incomingBarcode, setIncomingBarcode] = useState<{ code: string; seq: number } | null>(
    null,
  );
  const demoModeEnabled = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false';

  const registerShortcutsRef = useRef({
    newSale: () => {},
    focusSearch: () => {},
    parkSale: () => {},
    cashCheckout: () => {},
    reprintLast: () => {},
  });

  useEffect(() => {
    const hasBridge = typeof window !== 'undefined' && Boolean(window.quickcartDesktop);
    setIsElectronRuntime(hasBridge);
    if (hasBridge && window.quickcartDesktop?.runtime?.getInfo) {
      void window.quickcartDesktop.runtime
        .getInfo()
        .then((info) => {
          if (info.dataFilePath) setDataFilePath(info.dataFilePath);
        })
        .catch(() => undefined);
    }
  }, []);

  const healthQuery = useQuery({
    queryKey: ['desktop-health'],
    queryFn: fetchHealth,
    refetchInterval: 20_000,
  });

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    retry: false,
  });

  const pushHardwareEvent = useCallback((device: string, detail: string) => {
    setHardwareEvents((current) =>
      [
        {
          id: crypto.randomUUID(),
          time: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          }),
          device,
          detail,
        },
        ...current,
      ].slice(0, 20),
    );
  }, []);

  const operatorLogin = useMutation({
    mutationFn: (email: string) => login(email, 'QuickMart!dev123'),
    onSuccess: (result) => {
      setSession(result.accessToken, result.user);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-shift'] });
      void queryClient.invalidateQueries({ queryKey: ['desktop-pos-parked'] });
      void queryClient.invalidateQueries({ queryKey: ['desktop-inventory'] });
      void queryClient.invalidateQueries({ queryKey: ['desktop-alerts'] });
    },
  });

  const operatorLogout = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      clearSession();
      queryClient.clear();
    },
  });

  const handleKickDrawer = useCallback(() => {
    if (window.quickcartDesktop?.drawer) {
      void window.quickcartDesktop.drawer.open().then((res) => {
        pushHardwareEvent('Cash drawer', `Sent ESC/POS pulse (${res.commandHex})`);
      });
    } else {
      pushHardwareEvent('Cash drawer', `Dispatched RJ-11 pulse (${DRAWER_KICK_HEX})`);
    }
  }, [pushHardwareEvent]);

  const handlePrintSlip = useCallback(
    (slip: ThermalSlipInput, paperWidth: 42 | 32, silent: boolean, deviceName?: string) => {
      if (window.quickcartDesktop?.printer) {
        void window.quickcartDesktop.printer.printReceipt(slip, deviceName).then(() => {
          pushHardwareEvent(
            'Thermal printer',
            `Printed ${slip.invoiceNumber} (${paperWidth === 42 ? '80mm' : '58mm'}${deviceName ? ` · ${deviceName}` : ''})`,
          );
        });
      } else {
        pushHardwareEvent(
          'Thermal printer',
          `${silent ? 'Silent print' : 'Preview print'} ${slip.invoiceNumber} (${paperWidth === 42 ? '80mm' : '58mm'})`,
        );
      }
    },
    [pushHardwareEvent],
  );

  const handleSimulateScan = useCallback(
    (barcode: string, name: string) => {
      pushHardwareEvent('USB barcode wedge', `Decoded ${barcode} (${name})`);
      setIncomingBarcode((prev) => ({ code: barcode, seq: (prev?.seq ?? 0) + 1 }));
      setSection('register');
    },
    [pushHardwareEvent],
  );

  const toggleKiosk = useCallback(() => {
    setIsKiosk((prev) => {
      const next = !prev;
      void window.quickcartDesktop?.window.setKiosk(next);
      if (next) setSection('kiosk');
      return next;
    });
  }, []);

  // Global desktop POS keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F11') {
        event.preventDefault();
        toggleKiosk();
      } else if (section === 'register') {
        if (event.key === 'F1') {
          event.preventDefault();
          registerShortcutsRef.current.newSale();
        } else if (event.key === 'F2') {
          event.preventDefault();
          registerShortcutsRef.current.focusSearch();
        } else if (event.key === 'F4') {
          event.preventDefault();
          registerShortcutsRef.current.parkSale();
        } else if (event.key === 'F8') {
          event.preventDefault();
          registerShortcutsRef.current.cashCheckout();
        } else if (event.key === 'F9') {
          event.preventDefault();
          registerShortcutsRef.current.reprintLast();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [section, toggleKiosk]);

  const user = meQuery.data;
  const permissions = user?.permissions ?? [];
  const canOperatePos = permissions.includes('pos:operate');
  const canReadInventory = permissions.includes('inventory:read');
  const canAdjustInventory = permissions.includes('inventory:adjust');

  if (isMinimized) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-[#e9e4da] p-6">
        <div className="w-full max-w-md rounded-xl border border-line bg-card p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-ink">QuickCart Desktop is minimized</p>
          <p className="mt-1 text-xs text-ink-2">
            Background local server stays active on 127.0.0.1 while minimized to the Windows taskbar.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Button size="sm" onClick={() => setIsMinimized(false)}>
              Restore window
            </Button>
            <Button size="sm" variant="secondary" onClick={() => router.push('/')}>
              Return to web
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-dvh w-full flex-col bg-[#e9e4da] md:h-dvh md:overflow-hidden ${
        isMaximized || isKiosk ? 'p-0' : 'p-4 lg:p-6'
      }`}
    >
      <div
        data-testid="desktop-window-frame"
        className={`mx-auto flex min-h-0 flex-1 w-full flex-col overflow-hidden bg-paper ${
          isMaximized || isKiosk
            ? 'max-w-none rounded-none border-0'
            : 'max-w-[1380px] rounded-xl border border-[#d6cfc2] shadow-[0_18px_48px_rgba(31,27,22,0.12)]'
        }`}
      >
        {/* Frameless Windows Electron Titlebar */}
        <header className="desktop-drag flex h-11 shrink-0 items-center justify-between gap-4 border-b border-line bg-[#1f1b16] px-4 text-[#f7f4ee] select-none">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="flex h-5 w-5 shrink-0 flex-col justify-between rounded-[4px] bg-[#f7f4ee] p-[3px]"
              aria-hidden
            >
              <span className="h-[2px] w-full rounded-full bg-[#1f1b16]" />
              <span className="h-[2px] w-full rounded-full bg-accent" />
              <span className="h-[2px] w-full rounded-full bg-[#1f1b16]" />
            </span>
            <span className="text-sm font-semibold tracking-tight whitespace-nowrap shrink-0">
              QuickCart Desktop
            </span>
            <span className="hidden text-xs text-[#b8afa2] sm:inline whitespace-nowrap">
              QuickMart Panaji / {SECTION_META[section].label}
            </span>
          </div>

          <div className="desktop-no-drag flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={toggleKiosk}
              aria-label={isKiosk ? 'Exit kiosk mode' : 'Enter kiosk mode'}
              className="mr-2 flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-[#e6dfd4] transition-colors hover:bg-white/10 whitespace-nowrap"
            >
              {isKiosk ? (
                <>
                  <Minimize2 className="size-3.5" aria-hidden />
                  Exit kiosk (F11)
                </>
              ) : (
                <>
                  <Maximize2 className="size-3.5" aria-hidden />
                  Kiosk (F11)
                </>
              )}
            </button>

            <button
              type="button"
              aria-label="Minimize window"
              onClick={() => {
                if (window.quickcartDesktop?.window) {
                  void window.quickcartDesktop.window.minimize();
                } else {
                  setIsMinimized(true);
                }
              }}
              className="flex h-8 w-9 items-center justify-center rounded text-[#e6dfd4] transition-colors hover:bg-white/10"
            >
              <Minus className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? 'Restore window size' : 'Maximize window'}
              onClick={() => {
                if (window.quickcartDesktop?.window) {
                  void window.quickcartDesktop.window
                    .toggleMaximize()
                    .then((st) => setIsMaximized(st.isMaximized));
                } else {
                  setIsMaximized((prev) => !prev);
                }
              }}
              className="flex h-8 w-9 items-center justify-center rounded text-[#e6dfd4] transition-colors hover:bg-white/10"
            >
              <Square className="size-3" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Close desktop window"
              onClick={() => {
                if (window.quickcartDesktop?.window) {
                  void window.quickcartDesktop.window.close();
                } else {
                  router.push('/');
                }
              }}
              className="flex h-8 w-9 items-center justify-center rounded text-[#e6dfd4] transition-colors hover:bg-[#b91c1c] hover:text-white"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        </header>

        {/* Main Workspace Body: 240px Rail + Viewport */}
        <div className="flex flex-1 min-h-0 flex-col md:flex-row">
          {!isKiosk && (
            <aside className="flex w-full shrink-0 flex-col justify-between border-b border-line bg-card p-4 md:w-60 md:overflow-y-auto md:border-b-0 md:border-r">
              <div>
                <p className="px-2.5 text-xs font-medium text-ink-3">Workspaces</p>
                <nav className="mt-2 flex flex-row gap-1 overflow-x-auto md:flex-col">
                  {(
                    [
                      { id: 'register', label: 'POS Register', icon: Store },
                      { id: 'kiosk', label: 'Self-Checkout Kiosk', icon: ShoppingBasket },
                      { id: 'stock', label: 'Stockroom Ledger', icon: Boxes },
                      { id: 'hardware', label: 'Hardware & Printer', icon: Cpu },
                      { id: 'package', label: 'Windows .exe', icon: Package },
                    ] as const
                  ).map((navItem) => {
                    const Icon = navItem.icon;
                    const active = section === navItem.id;
                    return (
                      <button
                        key={navItem.id}
                        type="button"
                        onClick={() => setSection(navItem.id)}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                          active
                            ? 'bg-accent text-white'
                            : 'text-ink-2 hover:bg-raised hover:text-ink'
                        }`}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden />
                        <span>{navItem.label}</span>
                      </button>
                    );
                  })}
                </nav>
              </div>

              <div className="mt-6 border-t border-line pt-4">
                <div className="flex items-center justify-between text-xs text-ink-2">
                  <span>Local API</span>
                  <span className="font-medium text-accent">
                    {healthQuery.isSuccess ? 'Connected' : 'Checking…'}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-ink-2">
                  <span>Runtime</span>
                  <span className="font-mono text-[11px] text-ink">
                    {isElectronRuntime ? 'Electron .exe' : 'Desktop preview'}
                  </span>
                </div>

                <div className="mt-4 border-t border-line pt-3">
                  {user ? (
                    <div>
                      <p className="truncate text-sm font-medium text-ink">{user.fullName}</p>
                      <p className="text-xs text-ink-2">{user.roles.join(', ')}</p>
                      {demoModeEnabled && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5">
                          {DEMO_OPERATORS.filter((op) => op.email !== user.email).map((op) => (
                            <button
                              key={op.email}
                              type="button"
                              disabled={operatorLogin.isPending}
                              onClick={() => operatorLogin.mutate(op.email)}
                              className="rounded-md border border-line bg-paper px-2 py-1 text-[11px] font-medium text-ink-2 transition-colors hover:border-accent hover:text-ink"
                            >
                              {op.label}
                            </button>
                          ))}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => operatorLogout.mutate()}
                        className="mt-2.5 text-xs font-medium text-ink-2 hover:text-ink"
                      >
                        Lock terminal (Sign out)
                      </button>
                    </div>
                  ) : demoModeEnabled ? (
                    <div>
                      <p className="text-xs font-medium text-ink">Quick operator unlock</p>
                      <p className="mt-0.5 text-[11px] text-ink-2">
                        Sign in with one click for demo lane testing.
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-1.5">
                        {DEMO_OPERATORS.map((op) => (
                          <button
                            key={op.email}
                            type="button"
                            disabled={operatorLogin.isPending}
                            onClick={() => operatorLogin.mutate(op.email)}
                            className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:border-accent hover:bg-accent-soft"
                          >
                            {op.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-medium text-ink">Staff authentication</p>
                      <Link
                        href="/login"
                        className="mt-2 inline-flex h-8 w-full items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white hover:bg-ink"
                      >
                        Sign in with staff account
                      </Link>
                    </div>
                  )}
                </div>

                {isElectronRuntime ? (
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/`;
                      void window.quickcartDesktop?.shell?.openExternal(url);
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2 hover:text-ink"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    Open web storefront
                  </button>
                ) : (
                  <Link
                    href="/"
                    className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-2 hover:text-ink"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    Open web storefront
                  </Link>
                )}
              </div>
            </aside>
          )}

          {/* Content Area */}
          <main className="flex-1 overflow-y-auto p-5 lg:p-7">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-ink">
                  {SECTION_META[section].label}
                </h1>
                <p className="mt-0.5 text-sm text-ink-2">{SECTION_META[section].subtitle}</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-ink-2">
                <span>QuickMart Panaji · QM-PAN</span>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1 text-ink">
                  <Monitor className="size-3.5 text-ink-3" aria-hidden />
                  Windows x64 target
                </span>
              </div>
            </div>

            {section === 'register' &&
              (user && canOperatePos ? (
                <DesktopRegisterView
                  incomingBarcode={incomingBarcode}
                  onBarcodeConsumed={() => setIncomingBarcode(null)}
                  onReceiptCreated={(slip) => setLastReceipt(slip)}
                  onPrintSlip={handlePrintSlip}
                  onKickDrawer={handleKickDrawer}
                  registerShortcutsRef={registerShortcutsRef}
                />
              ) : (
                <OperatorGate
                  title="Sign in to unlock Lane 01 Register"
                  description={
                    user
                      ? `Signed in as ${user.fullName} (${user.roles.join(', ')}), which does not include register access. Switch to Cashier or Admin to operate the lane.`
                      : 'Select a seeded terminal operator to open a live register session with cash tendering, barcode scans, and thermal slips.'
                  }
                  pending={operatorLogin.isPending}
                  onPick={(email) => operatorLogin.mutate(email)}
                  preferredRoles={['Cashier', 'Admin']}
                />
              ))}

            {section === 'kiosk' && (
              <div className="mx-auto max-w-2xl">
                <ShopPage />
              </div>
            )}

            {section === 'stock' &&
              (user && canReadInventory ? (
                <DesktopStockView canAdjust={canAdjustInventory} />
              ) : (
                <OperatorGate
                  title="Sign in to view Stockroom Ledger"
                  description="Select Inventory, Manager, or Admin to inspect branch balances, low-stock alerts, and FEFO near-expiry batches."
                  pending={operatorLogin.isPending}
                  onPick={(email) => operatorLogin.mutate(email)}
                  preferredRoles={['Inventory', 'Admin']}
                />
              ))}

            {section === 'hardware' && (
              <DesktopHardwareView
                isElectronRuntime={isElectronRuntime}
                lastReceipt={lastReceipt}
                events={hardwareEvents}
                onSimulateScan={handleSimulateScan}
                onKickDrawer={handleKickDrawer}
                onPrintSlip={handlePrintSlip}
              />
            )}

            {section === 'package' && (
              <DesktopExeView
                isElectronRuntime={isElectronRuntime}
                dataFilePath={dataFilePath}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function OperatorGate({
  title,
  description,
  pending,
  onPick,
  preferredRoles,
}: {
  title: string;
  description: string;
  pending: boolean;
  onPick: (email: string) => void;
  preferredRoles: string[];
}) {
  const picks = DEMO_OPERATORS.filter((op) => preferredRoles.includes(op.label));
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-line bg-card p-6">
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{description}</p>
      <div className="mt-5 flex flex-wrap gap-2.5">
        {picks.map((op, index) => (
          <Button
            key={op.email}
            variant={index === 0 ? 'primary' : 'secondary'}
            disabled={pending}
            onClick={() => onPick(op.email)}
          >
            {pending ? 'Unlocking…' : `Sign in as ${op.label}`}
          </Button>
        ))}
      </div>
    </div>
  );
}
