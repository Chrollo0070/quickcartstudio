'use client';

import { useState } from 'react';
import { Printer, ScanBarcode, Vault, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DRAWER_KICK_HEX,
  formatThermalText,
  QUICK_SCAN_ITEMS,
  type ThermalSlipInput,
} from '@/lib/desktop-receipt';

export interface HardwareEvent {
  id: string;
  time: string;
  device: string;
  detail: string;
}

const SAMPLE_SLIP: ThermalSlipInput = {
  invoiceNumber: 'QM-PAN-1000',
  issuedAt: 'Test Slip',
  storeName: 'QuickMart Panaji',
  storeAddress: '18 June Road, Panaji',
  gstin: '30ABCDE1234F1Z5',
  lines: [
    { name: 'Amul Toned Milk 500ml', quantity: '2', unitPrice: '27.00', lineTotal: '54.00' },
    { name: 'Britannia White Bread 400g', quantity: '1', unitPrice: '45.00', lineTotal: '47.25' },
  ],
  subtotal: '99.00',
  taxTotal: '2.25',
  grandTotal: '101.25',
  paymentMethod: 'CASH',
  tendered: '200.00',
  changeDue: '98.75',
};

export function DesktopHardwareView({
  lastReceipt,
  events,
  onSimulateScan,
  onKickDrawer,
  onPrintSlip,
}: {
  lastReceipt: ThermalSlipInput | null;
  events: HardwareEvent[];
  onSimulateScan: (barcode: string, name: string) => void;
  onKickDrawer: () => void;
  onPrintSlip: (slip: ThermalSlipInput, paperWidth: 42 | 32, silent: boolean) => void;
}) {
  const [paperWidth, setPaperWidth] = useState<42 | 32>(42);
  const [silentPrint, setSilentPrint] = useState(true);
  const [selectedPrinter, setSelectedPrinter] = useState('EPSON TM-T82III Thermal (USB001)');

  const activeSlip = lastReceipt ?? SAMPLE_SLIP;
  const formattedText = formatThermalText(activeSlip, paperWidth);

  const downloadPlainReceipt = () => {
    const blob = new Blob([formattedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeSlip.invoiceNumber}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-testid="desktop-hardware-view" className="grid gap-6 lg:grid-cols-[1.25fr_0.95fr]">
      <div className="flex flex-col gap-6">
        <section className="rounded-xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-ink">Thermal receipt printer</h2>
              <p className="mt-0.5 text-sm text-ink-2">
                Silent Windows spooler printing via Electron offscreen BrowserWindow.
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg bg-raised p-1">
              <button
                type="button"
                onClick={() => setPaperWidth(42)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  paperWidth === 42 ? 'bg-card text-ink shadow-xs' : 'text-ink-2 hover:text-ink'
                }`}
              >
                80mm (42 col)
              </button>
              <button
                type="button"
                onClick={() => setPaperWidth(32)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  paperWidth === 32 ? 'bg-card text-ink shadow-xs' : 'text-ink-2 hover:text-ink'
                }`}
              >
                58mm (32 col)
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="printer-select" className="block text-xs font-medium text-ink-2">
                Windows printer device
              </label>
              <select
                id="printer-select"
                value={selectedPrinter}
                onChange={(event) => setSelectedPrinter(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-lg border border-line bg-paper px-3 text-sm text-ink focus:border-accent focus:outline-none"
              >
                <option value="EPSON TM-T82III Thermal (USB001)">EPSON TM-T82III Thermal (USB001)</option>
                <option value="Star TSP143IIIU Cutter (USB002)">Star TSP143IIIU Cutter (USB002)</option>
                <option value="Microsoft Print to PDF">Microsoft Print to PDF</option>
              </select>
            </div>

            <div className="flex items-end justify-between rounded-lg border border-line bg-paper px-3.5 py-2.5">
              <div>
                <p className="text-sm font-medium text-ink">Silent print on checkout</p>
                <p className="text-xs text-ink-2">Skip Windows print dialog</p>
              </div>
              <input
                type="checkbox"
                checked={silentPrint}
                onChange={(event) => setSilentPrint(event.target.checked)}
                aria-label="Silent print on checkout"
                className="h-4 w-4 accent-accent"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => onPrintSlip(activeSlip, paperWidth, silentPrint)}
              className="gap-1.5"
            >
              <Printer className="size-4" aria-hidden />
              Print test slip
            </Button>
            <Button size="sm" variant="secondary" onClick={onKickDrawer} className="gap-1.5">
              <Vault className="size-4" aria-hidden />
              Kick cash drawer ({DRAWER_KICK_HEX})
            </Button>
            <Button size="sm" variant="ghost" onClick={downloadPlainReceipt} className="gap-1.5">
              <Download className="size-4" aria-hidden />
              Export .txt slip
            </Button>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-card p-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-ink">USB HID barcode scanner wedge</h2>
              <p className="mt-0.5 text-sm text-ink-2">
                Trigger a keyboard-wedge EAN-13 scan directly into the active register cart.
              </p>
            </div>
            <ScanBarcode className="size-5 text-ink-3" aria-hidden />
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {QUICK_SCAN_ITEMS.map((item) => (
              <button
                key={item.barcode}
                type="button"
                onClick={() => onSimulateScan(item.barcode, item.name)}
                className="flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-accent-soft"
              >
                <span className="min-w-0 pr-2">
                  <span className="block truncate text-sm font-medium text-ink">{item.name}</span>
                  <span className="block font-mono text-xs text-ink-2">{item.barcode}</span>
                </span>
                <span className="shrink-0 text-xs font-medium text-accent whitespace-nowrap">
                  Scan
                </span>
              </button>
            ))}
          </div>
        </section>

        <section
          data-testid="hardware-event-log"
          className="rounded-xl border border-line bg-card p-5"
        >
          <h2 className="text-base font-semibold text-ink">Hardware bridge log</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            Recent printer, cash drawer, and USB scanner IPC actions from this session.
          </p>
          {events.length === 0 ? (
            <p className="mt-4 text-sm text-ink-3">
              No hardware actions recorded yet — trigger a test slip, drawer kick, or barcode scan above.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-line text-sm">
              {events.slice(0, 8).map((ev) => (
                <li key={ev.id} className="flex items-center justify-between gap-4 py-2">
                  <span className="min-w-0 truncate text-ink">
                    <span className="font-medium">{ev.device}</span>
                    <span className="mx-1.5 text-ink-3">·</span>
                    <span className="text-ink-2">{ev.detail}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-3 tabular-nums">
                    {ev.time}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="flex flex-col rounded-xl border border-line bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Live thermal output</h2>
            <p className="mt-0.5 text-xs text-ink-2">
              {paperWidth === 42 ? '80mm roll · 42 chars/line' : '58mm roll · 32 chars/line'} ·{' '}
              {selectedPrinter}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-1 items-start justify-center rounded-lg bg-raised p-5">
          <pre
            data-testid="thermal-slip-preview"
            className="receipt w-full max-w-[360px] overflow-x-auto rounded-lg border border-line p-4 text-[12px] leading-relaxed text-ink"
          >
            {formattedText}
          </pre>
        </div>
      </section>
    </div>
  );
}
