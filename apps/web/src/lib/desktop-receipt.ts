export interface ThermalSlipLine {
  name: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface ThermalSlipInput {
  invoiceNumber: string;
  issuedAt: string;
  storeName: string;
  storeAddress: string;
  gstin: string;
  lines: ThermalSlipLine[];
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  paymentMethod: string;
  tendered?: string;
  changeDue?: string;
}

export interface TenderResult {
  valid: boolean;
  changeDue: string;
  shortfall: string;
}

export interface DesktopShortcut {
  key: string;
  action: string;
  scope: string;
}

export interface ExeTargetSpec {
  id: 'zip' | 'nsis' | 'portable';
  label: string;
  filename: string;
  installFootprint: string;
  startupFlow: string;
  idealFor: string;
  features: string[];
  buildCommand: string;
}

export const DRAWER_KICK_HEX = '1B 70 00 19 FA';

export const QUICK_SCAN_ITEMS = [
  { name: 'Amul Toned Milk 500ml', barcode: '8900100000424', price: '27.00', gst: '0%' },
  { name: 'Britannia White Bread 400g', barcode: '8900100000844', price: '45.00', gst: '5%' },
  { name: 'Parle-G Gold 65g', barcode: '8900100001964', price: '10.00', gst: '18%' },
  { name: 'Amul Butter 100g', barcode: '8900100000561', price: '58.00', gst: '12%' },
  { name: 'Tata Salt 1kg', barcode: '8900100001407', price: '28.00', gst: '0%' },
  { name: 'Bisleri Water 1L', barcode: '8900100001681', price: '20.00', gst: '18%' },
] as const;

export const DESKTOP_SHORTCUTS: DesktopShortcut[] = [
  { key: 'F1', action: 'Open new register sale', scope: 'Register' },
  { key: 'F2', action: 'Focus barcode / SKU search', scope: 'Register' },
  { key: 'F4', action: 'Suspend (park) active cart', scope: 'Register' },
  { key: 'F8', action: 'Complete cash tender & kick drawer', scope: 'Register' },
  { key: 'F9', action: 'Reprint last 80mm thermal receipt', scope: 'Register' },
  { key: 'F11', action: 'Toggle frameless kiosk fullscreen', scope: 'Window' },
];

export const IPC_BRIDGE_CHANNELS = [
  {
    channel: 'quickcart:window:minimize / toggle-maximize / close',
    direction: 'Renderer -> Main',
    purpose: 'Custom frameless Windows titlebar controls without exposing Node APIs',
  },
  {
    channel: 'quickcart:window:set-kiosk',
    direction: 'Renderer -> Main',
    purpose: 'Locks terminal into fullscreen customer self-checkout kiosk mode',
  },
  {
    channel: 'quickcart:printer:list',
    direction: 'Renderer -> Main',
    purpose: 'Enumerates Windows spooler thermal printers via webContents.getPrintersAsync()',
  },
  {
    channel: 'quickcart:printer:print-receipt',
    direction: 'Renderer -> Main',
    purpose: 'Silent 80mm thermal slip printing via isolated offscreen BrowserWindow',
  },
  {
    channel: 'quickcart:drawer:open',
    direction: 'Renderer -> Main',
    purpose: 'Dispatches ESC/POS RJ-11 cash drawer pulse (1B 70 00 19 FA)',
  },
  {
    channel: 'quickcart:runtime:info',
    direction: 'Renderer -> Main',
    purpose: 'Returns packaged version, Electron/Node runtime, ephemeral local port & userData path',
  },
] as const;

export const EXE_TARGETS: ExeTargetSpec[] = [
  {
    id: 'zip',
    label: 'Windows Bundle (.exe zip)',
    filename: 'QuickCart-0.1.0-win-x64.zip',
    installFootprint: 'Ready-to-run QuickCart.exe + standalone runtime · Windows 10/11 x64',
    startupFlow:
      'Unzip on any Windows 10/11 PC and double-click QuickCart.exe — boots the embedded Next.js server on 127.0.0.1 with zero installer or admin rights.',
    idealFor: 'Instant Windows deployment, USB rollout, and direct download from this workspace.',
    features: [
      'Contains packaged Win32 x64 QuickCart.exe + app.asar + embedded Next.js standalone server',
      'Zero installation or registry edits — extract anywhere and launch QuickCart.exe',
      'Cross-compiled directly with Electron 34.5.8 x64 and verified ASAR integrity',
      'Includes frameless titlebar, F11 Kiosk mode, system tray, and thermal printer IPC bridge',
    ],
    buildCommand: 'npm run build && cd apps/desktop && npm install && npm run dist:win:zip',
  },
  {
    id: 'nsis',
    label: 'Windows Installer (.exe)',
    filename: 'QuickCart-Setup-0.1.0.exe',
    installFootprint: '~142 MB installed · Windows 10/11 x64',
    startupFlow: 'Installs per-user or per-machine, registers Start Menu & Desktop shortcuts, runs standalone Next.js server on 127.0.0.1.',
    idealFor: 'Permanent checkout lanes and back-office stockroom PCs with auto-update support.',
    features: [
      'Guided NSIS installer with selectable install directory and clean uninstaller',
      'Bundled Next.js standalone server (no Node.js installation required on counter PC)',
      'Single-instance lock prevents accidental duplicate registers on double-click',
      'System tray menu for quick switch between Staff Register and Kiosk mode',
    ],
    buildCommand: 'npm run build && cd apps/desktop && npm install && npm run dist:win',
  },
  {
    id: 'portable',
    label: 'Portable Single-File (.exe)',
    filename: 'QuickCart-0.1.0-Portable.exe',
    installFootprint: '~98 MB single file · Zero registry writes',
    startupFlow: 'Extracts runtime to temp on launch, boots local server, and stores shift state in %APPDATA%\\QuickCart.',
    idealFor: 'Pop-up billing desks, locked-down Windows terminals without admin rights, and USB deployment.',
    features: [
      'Zero-install single executable runnable directly from a USB drive or shared folder',
      'Runs under standard Windows user privileges (requestedExecutionLevel: asInvoker)',
      'Identical sandboxed preload IPC bridge for 80mm thermal printers and USB barcode wedges',
      'Cleanly terminates embedded Next.js child process on exit with no orphan ports',
    ],
    buildCommand: 'npm run build && cd apps/desktop && npm install && npm run dist:portable',
  },
];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calculateTenderChange(grandTotal: number, tendered: number): TenderResult {
  const total = Math.max(0, round2(grandTotal));
  const paid = Math.max(0, round2(tendered));
  if (paid + 0.0001 >= total) {
    return {
      valid: true,
      changeDue: round2(paid - total).toFixed(2),
      shortfall: '0.00',
    };
  }
  return {
    valid: false,
    changeDue: '0.00',
    shortfall: round2(total - paid).toFixed(2),
  };
}

export function suggestCashDenominations(grandTotal: number): number[] {
  const exact = round2(grandTotal);
  if (exact <= 0) return [50, 100, 200, 500];
  const candidates = new Set<number>([
    Math.ceil(exact),
    Math.ceil(exact / 10) * 10,
    Math.ceil(exact / 50) * 50,
    Math.ceil(exact / 100) * 100,
    Math.ceil(exact / 500) * 500,
  ]);
  return [...candidates]
    .filter((v) => v >= exact)
    .sort((a, b) => a - b)
    .slice(0, 4);
}

function centerLine(text: string, width: number): string {
  const trimmed = text.slice(0, width);
  const pad = Math.max(0, Math.floor((width - trimmed.length) / 2));
  return ' '.repeat(pad) + trimmed;
}

function pairLine(left: string, right: string, width: number): string {
  const maxLeft = Math.max(1, width - right.length - 1);
  const clippedLeft = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const gap = Math.max(1, width - clippedLeft.length - right.length);
  return clippedLeft + ' '.repeat(gap) + right;
}

export function formatThermalText(receipt: ThermalSlipInput, width = 42): string {
  const rule = '-'.repeat(width);
  const out: string[] = [
    centerLine(receipt.storeName.toUpperCase(), width),
    centerLine(receipt.storeAddress, width),
    centerLine(`GSTIN ${receipt.gstin}`, width),
    rule,
    pairLine(`INV ${receipt.invoiceNumber}`, receipt.issuedAt, width),
    rule,
  ];

  for (const line of receipt.lines) {
    out.push(line.name.slice(0, width));
    out.push(pairLine(`  ${line.quantity} x ${line.unitPrice}`, line.lineTotal, width));
  }

  out.push(rule);
  out.push(pairLine('Subtotal', `INR ${receipt.subtotal}`, width));
  out.push(pairLine('GST (CGST+SGST)', `INR ${receipt.taxTotal}`, width));
  out.push(pairLine('TOTAL', `INR ${receipt.grandTotal}`, width));

  if (receipt.tendered) {
    out.push(pairLine('Tendered', `INR ${receipt.tendered}`, width));
  }
  if (receipt.changeDue) {
    out.push(pairLine('Change Due', `INR ${receipt.changeDue}`, width));
  }

  out.push(rule);
  out.push(centerLine(`Paid via ${receipt.paymentMethod}`, width));
  out.push(centerLine('Thank you for shopping at QuickMart', width));

  return out.join('\n');
}
