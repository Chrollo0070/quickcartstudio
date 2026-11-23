# QuickCart Desktop (Windows `.exe`)

Electron desktop shell for QuickCart POS & Self-Checkout Kiosk, packaging the Next.js `standalone` runtime from `apps/web/.next/standalone` into standalone Windows x64 executables.

## One-Click Build on Windows

Double-click `apps\desktop\build-exe.bat` or run from PowerShell:

```powershell
.\apps\desktop\scripts\build-win-exe.ps1 -Target all
```

Artifacts are written to `apps/desktop/release/`:
- `QuickCart-Setup-0.1.0.exe` — Guided NSIS installer (Desktop + Start Menu shortcuts, uninstaller, auto-update ready)
- `QuickCart-0.1.0-Portable.exe` — Single-file portable executable (zero install, zero registry writes)

## Automated Build via GitHub Actions

Run the **`Build Windows Desktop (.exe)`** workflow (`.github/workflows/desktop-win-exe.yml`) manually via `workflow_dispatch`, or push a version tag (`v0.1.0`) to build on `windows-latest`, generate `SHA256SUMS.txt`, upload artifacts, and attach `.exe` files to the GitHub Release.

## Manual Commands

```bash
# 1. Build shared package and Next.js standalone bundle at repo root
npm run build

# 2. Install desktop builder dependencies and package Windows .exe
cd apps/desktop
npm install
npm run dist:win       # Builds NSIS installer + Portable .exe (Windows / Wine)
npm run dist:portable  # Builds Portable .exe only
npm run dist:win:linux # Cross-builds Windows .exe on Linux without Wine (skips PE icon stamping)
```

## Security & Hardware Architecture

- `BrowserWindow` runs with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- `preload.ts` exposes a narrow `window.quickcartDesktop` IPC bridge for frameless window controls, `F11` kiosk fullscreen, Windows spooler printer enumeration, silent 80mm thermal receipt printing, and RJ-11 cash drawer pulse dispatch (`1B 70 00 19 FA`).
- The embedded Next.js standalone server binds strictly to `127.0.0.1` on an ephemeral loopback port and shuts down cleanly on quit.
