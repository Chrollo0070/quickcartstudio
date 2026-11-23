import Link from 'next/link';
import { StatusCard } from './status-card';

const receiptLines = [
  { name: 'Amul Toned Milk 500ml', qty: '2 × 27.00', total: '54.00' },
  { name: 'Britannia White Bread 400g', qty: '1 × 45.00', total: '47.25' },
];

const demoLogins = [
  { role: 'Admin', email: 'admin@quickmart.dev' },
  { role: 'Manager', email: 'manager@quickmart.dev' },
  { role: 'Cashier', email: 'cashier@quickmart.dev' },
  { role: 'Inventory', email: 'inventory@quickmart.dev' },
] as const;

const demoBarcodes = [
  { label: 'Amul Toned Milk 500ml', code: '8900100000424' },
  { label: 'Britannia White Bread', code: '8900100000844' },
  { label: 'Parle-G Gold 65g', code: '8900100001964' },
] as const;

/** The product's real output, rendered as the hero object: a QuickCart receipt. */
function ReceiptPreview() {
  return (
    <figure className="receipt mx-auto w-full max-w-xs rounded-xl p-5">
      <figcaption className="text-center">
        <p className="text-[13px] font-medium">QuickMart Panaji</p>
        <p className="mt-0.5 text-[11px] text-ink-3">18 June Road, Panaji · GSTIN 30ABC…1Z5</p>
      </figcaption>
      <div className="receipt-tear my-3" />
      <div className="space-y-2 text-[12px] leading-relaxed">
        {receiptLines.map((line) => (
          <div key={line.name}>
            <p className="text-ink">{line.name}</p>
            <p className="flex justify-between text-ink-2">
              <span>{line.qty}</span>
              <span className="num">{line.total}</span>
            </p>
          </div>
        ))}
      </div>
      <div className="receipt-tear my-3" />
      <div className="space-y-1 text-[12px] text-ink-2">
        <p className="flex justify-between">
          <span>Subtotal</span>
          <span className="num">99.00</span>
        </p>
        <p className="flex justify-between">
          <span>GST 5% · CGST 1.12 + SGST 1.13</span>
          <span className="num">2.25</span>
        </p>
        <p className="flex justify-between pt-1 text-[14px] font-medium text-ink">
          <span>TOTAL</span>
          <span className="num">101.25</span>
        </p>
      </div>
      <div className="receipt-tear my-3" />
      <p className="text-center text-[11px] text-ink-3">Paid · MOCK · 101.25 · 21 Nov, 6:12 pm</p>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="flex flex-1 flex-col pb-16">
      <main>
        <section className="grid items-center gap-10 py-10 lg:grid-cols-2 lg:gap-16 lg:py-16">
          <div>
            <h1 className="font-serif text-5xl leading-[1.05] tracking-[-0.02em] sm:text-6xl">
              Scan. Pay. Go.
            </h1>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink-2">
              Supermarket self-checkout wired into the store&apos;s register and stockroom — one
              pricing engine, one stock ledger, receipts like this one on every sale.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-2.5">
              <Link
                href="/shop"
                className="inline-flex h-11 items-center rounded-lg bg-accent px-4 text-sm font-medium text-white shadow-[0_1px_2px_rgba(31,27,22,0.05)] transition-colors hover:bg-ink whitespace-nowrap"
              >
                Open self-checkout
              </Link>
              <Link
                href="/desktop"
                className="inline-flex h-11 items-center rounded-lg bg-card px-4 text-sm font-medium text-ink ring-1 ring-inset ring-line transition-colors hover:bg-raised whitespace-nowrap"
              >
                Desktop app (.exe)
              </Link>
              <Link
                href="/login"
                className="inline-flex h-11 items-center rounded-lg px-2.5 text-sm font-medium text-ink-2 transition-colors hover:text-ink whitespace-nowrap"
              >
                Staff sign in
              </Link>
            </div>
            <p className="mt-4 text-[13px] text-ink-3">
              QuickMart demo store · payment is simulated
            </p>
          </div>
          <ReceiptPreview />
        </section>

        <StatusCard />

        <section className="mt-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-card p-4">
            <p className="text-sm font-medium text-ink">Self-checkout</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Scan, cart, pay, digital receipt — no counter queue
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card p-4">
            <p className="text-sm font-medium text-ink">Staff POS</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Fast register with suspend/resume, cash and refunds
            </p>
          </div>
          <div className="rounded-xl border border-line bg-card p-4">
            <p className="text-sm font-medium text-ink">One stock ledger</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-2">
              Every sale decrements the same branch inventory, atomically
            </p>
          </div>
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-card p-6">
            <h2 className="text-sm font-medium text-ink-2">Development logins</h2>
            <p className="mt-1 text-sm text-ink-2">
              Password for all seeded users:{' '}
              <code className="font-mono text-[13px] text-ink">QuickMart!dev123</code>
            </p>
            <ul className="mt-4 divide-y divide-line">
              {demoLogins.map((login) => (
                <li key={login.email} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-ink">{login.role}</span>
                  <code className="font-mono text-[13px] text-ink-2">{login.email}</code>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-line bg-card p-6">
            <h2 className="text-sm font-medium text-ink-2">Demo barcodes</h2>
            <p className="mt-1 text-sm text-ink-2">
              Seeded EAN-13s for the scanner — or any custom QR holding these digits
            </p>
            <ul className="mt-4 divide-y divide-line">
              {demoBarcodes.map((item) => (
                <li key={item.code} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-ink">{item.label}</span>
                  <code className="font-mono text-[13px] text-ink-2">{item.code}</code>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="mt-14 border-t border-line pt-6 text-[13px] text-ink-3">
        QuickCart — supermarket self-checkout, POS and real-time inventory. Architecture and status
        live in docs/ of the repository
      </footer>
    </div>
  );
}
