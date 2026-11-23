import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
  type PrinterInfo,
} from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { buildThermalReceiptHtml, type ThermalReceiptPayload } from './receipt-html';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let serverProcess: ChildProcess | null = null;
let serverPort = 3000;
let isQuitting = false;

const DEV_URL = process.env.QUICKCART_DEV_URL?.trim();

function findAvailablePort(startPort = 3410): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(findAvailablePort(startPort + 1)));
    server.listen(startPort, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : startPort;
      server.close(() => resolve(port));
    });
    server.on('close', () => undefined);
    setTimeout(() => reject(new Error('Port allocation timed out')), 5000).unref();
  });
}

function waitForHealth(port: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const probe = () => {
      const req = http.get(
        { hostname: '127.0.0.1', port, path: '/api/v1/health', timeout: 1000 },
        (res) => {
          res.resume();
          if (res.statusCode && res.statusCode < 500) {
            resolve();
            return;
          }
          retry();
        },
      );
      req.on('error', retry);
      req.on('timeout', () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`QuickCart local server failed to respond on port ${port}`));
        return;
      }
      setTimeout(probe, 250);
    };

    probe();
  });
}

async function startEmbeddedWebServer(): Promise<string> {
  if (DEV_URL) {
    return DEV_URL;
  }

  const standaloneRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'standalone')
    : path.resolve(__dirname, '..', 'resources', 'standalone');

  const serverEntry = path.join(standaloneRoot, 'apps', 'web', 'server.js');
  const fallbackEntry = path.join(standaloneRoot, 'server.js');
  const entryScript = fs.existsSync(serverEntry) ? serverEntry : fallbackEntry;

  if (!fs.existsSync(entryScript)) {
    throw new Error(
      `Standalone server not found at ${entryScript}. Run "npm run prepare:standalone" before launching.`,
    );
  }

  serverPort = await findAvailablePort(3410);
  serverProcess = fork(entryScript, [], {
    cwd: path.dirname(entryScript),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      HOSTNAME: '127.0.0.1',
      PORT: String(serverPort),
    },
    stdio: 'pipe',
  });

  await waitForHealth(serverPort);
  return `http://127.0.0.1:${serverPort}/desktop`;
}

function stopEmbeddedWebServer(): void {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

function loadAppIcon() {
  const iconPath = path.resolve(__dirname, '..', 'build', 'icon.png');
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }
  return nativeImage.createEmpty();
}

function createWindow(startUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 680,
    title: 'QuickCart POS',
    icon: loadAppIcon(),
    backgroundColor: '#f7f4ee',
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('maximize', () => win.webContents.send('quickcart:window:state', getWindowState(win)));
  win.on('unmaximize', () => win.webContents.send('quickcart:window:state', getWindowState(win)));
  win.on('enter-full-screen', () =>
    win.webContents.send('quickcart:window:state', getWindowState(win)),
  );
  win.on('leave-full-screen', () =>
    win.webContents.send('quickcart:window:state', getWindowState(win)),
  );

  win.on('close', (event) => {
    if (!isQuitting && tray) {
      event.preventDefault();
      win.hide();
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  void win.loadURL(startUrl);
  return win;
}

function getWindowState(win: BrowserWindow) {
  return {
    isMaximized: win.isMaximized(),
    isKiosk: win.isFullScreen() || win.isKiosk(),
    platform: process.platform,
  };
}

function setupTray(startUrl: string): void {
  const baseIcon = loadAppIcon();
  const icon = baseIcon.isEmpty() ? baseIcon : baseIcon.resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('QuickCart POS Desktop');
  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Register',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Open Self-Checkout Kiosk',
      click: () => {
        if (mainWindow) {
          const origin = new URL(startUrl).origin;
          void mainWindow.loadURL(`${origin}/shop`);
          mainWindow.setKiosk(true);
          mainWindow.show();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit QuickCart',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('quickcart:window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('quickcart:window:toggle-maximize', () => {
    if (!mainWindow) return getWindowStateSafe();
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
    return getWindowState(mainWindow);
  });

  ipcMain.handle('quickcart:window:set-kiosk', (_event, enabled: boolean) => {
    if (!mainWindow) return getWindowStateSafe();
    mainWindow.setFullScreen(Boolean(enabled));
    return getWindowState(mainWindow);
  });

  ipcMain.handle('quickcart:window:close', () => {
    isQuitting = true;
    mainWindow?.close();
  });

  ipcMain.handle('quickcart:window:get-state', () => getWindowStateSafe());

  ipcMain.handle('quickcart:runtime:info', () => ({
    appName: app.getName(),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    serverPort,
    userDataPath: app.getPath('userData'),
  }));

  ipcMain.handle('quickcart:printer:list', async (): Promise<PrinterInfo[]> => {
    if (!mainWindow) return [];
    return mainWindow.webContents.getPrintersAsync();
  });

  ipcMain.handle(
    'quickcart:printer:print-receipt',
    async (_event, payload: ThermalReceiptPayload, deviceName?: string) => {
      const printWindow = new BrowserWindow({
        show: false,
        width: 320,
        height: 600,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      try {
        const html = buildThermalReceiptHtml(payload);
        await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
          printWindow.webContents.print(
            {
              silent: Boolean(deviceName),
              printBackground: false,
              deviceName: deviceName || undefined,
              margins: { marginType: 'none' },
              pageSize: { width: 80_000, height: 220_000 },
            },
            (success, failureReason) => {
              resolve(success ? { ok: true } : { ok: false, error: failureReason });
            },
          );
        });
      } finally {
        printWindow.destroy();
      }
    },
  );

  ipcMain.handle('quickcart:drawer:open', async () => {
    // ESC/POS drawer kick command bytes: ESC p m t1 t2 (0x1B 0x70 0x00 0x19 0xFA)
    return {
      ok: true,
      commandHex: '1B 70 00 19 FA',
      timestamp: new Date().toISOString(),
    };
  });
}

function getWindowStateSafe() {
  return mainWindow
    ? getWindowState(mainWindow)
    : { isMaximized: false, isKiosk: false, platform: process.platform };
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    registerIpcHandlers();
    const startUrl = await startEmbeddedWebServer();
    mainWindow = createWindow(startUrl);
    setupTray(startUrl);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    stopEmbeddedWebServer();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      stopEmbeddedWebServer();
      app.quit();
    }
  });
}
