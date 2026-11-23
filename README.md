# QuickCart

**Cross-platform supermarket self-checkout, Windows POS desktop (`.exe`), and real-time branch inventory platform.**

Customers scan product barcodes, build a cart, pay, and receive an itemized GST receipt — while staff POS registers, stockroom ledgers, and analytics dashboards share **one server-authoritative pricing engine, one order domain, and one stock ledger**.

---

## Key Capabilities

- **Windows Desktop POS (`.exe`) (`apps/desktop` & `/desktop`)** — Electron shell bundling the Next.js `standalone` server on `127.0.0.1` with a sandboxed preload IPC bridge (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`), frameless Windows titlebar, `F1`–`F11` counter shortcuts, live Windows printer enumeration, 80mm/58mm thermal slip output, Shift Close Z-Report reconciliation, and **offline-first persistence** in `%APPDATA%\QuickCart\quickcart-store.json`.
- **Customer Self-Checkout (`/shop`)** — Camera barcode scanner (`@zxing/browser`) + manual catalogue search, GST breakdown (CGST/SGST), loyalty redemption, promo coupons (`WELCOME10`, `SAVE25`), and digital receipts.
- **Staff POS & Inventory (`/pos`, `/inventory`, `/catalogue`, `/dashboard`)** — Keyboard-wedge barcode scans, park/resume sales, cash tendering with change calculation, refund approval workflow, FEFO near-expiry batch tracking, low-stock alerts, and live branch metrics.
- **Modular Monolith Backend (`apps/api`)** — NestJS 12 + Prisma 7 + PostgreSQL 17 (40 models), BigInt paise money math (`packages/shared`), RBAC guards with rotating SHA-256 refresh tokens, HMAC-verified payment webhooks, and Socket.IO live updates.

---

## Architecture & Tech Stack

| Layer | Technologies |
| --- | --- |
| **Web & Desktop UI** | Next.js 16 (App Router, `output: 'standalone'`) · React 19 · Tailwind CSS 4 · TanStack Query · Zod |
| **Desktop Shell (`.exe`)** | Electron 34 · `electron-builder` (Windows NSIS Installer, Portable `.exe`, and x64 `.zip` bundle) |
| **API Backend** | NestJS 12 · Prisma 7 · PostgreSQL 17 · Socket.IO · Swagger (`/api/v1/docs`) · Helmet & Throttler |
| **Quality & CI** | ESLint 9 · TypeScript 5.9 · Node Test (`node:test`) · Jest · Vitest · Playwright E2E · GitHub Actions |

Further documentation: [architecture](docs/architecture.md) · [ER diagram](docs/er-diagram.md) · [order state transitions](docs/order-state-transitions.md) · [API guidelines](docs/api-guidelines.md) · [security review](docs/security-review.md) · [ADRs](docs/decisions/).

---

## Quick Start (Zero-Setup Demo Mode)

Requires **Node.js ≥ 22.12**:

```bash
npm install
npm run dev
```

Open:
- Storefront & Self-Checkout: <http://localhost:3000/shop>
- Windows Desktop POS Workspace: <http://localhost:3000/desktop>
- Staff Login: <http://localhost:3000/login>

Seeded store: **QuickMart Panaji** (`QM-PAN`, Goa GST context). Demo password: **`QuickMart!dev123`**

| Role | Email |
| --- | --- |
| Admin | `admin@quickmart.dev` |
| Store Manager | `manager@quickmart.dev` |
| Cashier | `cashier@quickmart.dev` |
| Inventory Staff | `inventory@quickmart.dev` |

Demo EAN-13 barcodes: Amul Milk `8900100000424` · Britannia Bread `8900100000844` · Parle-G `8900100001964`.

---

## Building the Windows Desktop `.exe`

### On Windows (One-Click)
Double-click `apps\desktop\build-exe.bat` or run:

```powershell
.\apps\desktop\scripts\build-win-exe.ps1 -Target all
```

Artifacts are generated in `apps/desktop/release/`:
- `QuickCart-Setup-0.1.0.exe` — Guided Windows NSIS installer
- `QuickCart-0.1.0-Portable.exe` — Single-file portable executable

### Via GitHub Actions (Automated Release)
Push a version tag (e.g., `git tag v0.1.0 && git push --tags`) or trigger **`Build Windows Desktop (.exe)`** manually in GitHub Actions to compile on `windows-latest`, generate `SHA256SUMS.txt`, and publish downloadable `.exe` binaries to GitHub Releases.

---

## Hosting & Production Deployment

- **Portfolio Web Hosting (Vercel)**: `vercel.json` is preconfigured at the repository root. Set `NEXT_PUBLIC_DESKTOP_RELEASE_URL` to your GitHub Release URL so visitors can download the Windows `.exe` directly from `/desktop`.
- **Full-Stack Production (Render + Vercel + PostgreSQL)**:
  - Deploy `apps/api` + managed PostgreSQL using the included [`render.yaml`](render.yaml) blueprint and [`apps/api/Dockerfile`](apps/api/Dockerfile).
  - Deploy `apps/web` to Vercel with `API_ORIGIN=https://<your-api-domain>` and `NEXT_PUBLIC_DEMO_MODE=false`.
  - See [docs/deployment.md](docs/deployment.md) for production environment variables, migrations, and Redis schedulers.

---

## Testing & Verification

```bash
npm run lint
npm run typecheck
npm run build
npx --yes tsx --test apps/web/src/lib/demo-backend.test.ts apps/web/src/lib/demo-persistence.test.ts apps/web/src/lib/desktop-receipt.test.ts apps/desktop/src/receipt-html.test.ts
```

> **Disclaimer**: Demo checkout uses a simulated payment provider and seeded Indian GST rates for development and portfolio demonstration. Connect a live payment gateway and review tax rules with an accountant before commercial store use.
