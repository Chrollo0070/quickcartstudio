import { contextBridge, ipcRenderer } from 'electron';
import type { ThermalReceiptPayload } from './receipt-html';

export interface DesktopWindowState {
  isMaximized: boolean;
  isKiosk: boolean;
  platform: string;
}

export interface DesktopRuntimeInfo {
  appName: string;
  version: string;
  electronVersion: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  serverPort: number;
  userDataPath: string;
}

const desktopBridge = {
  window: {
    minimize: () => ipcRenderer.invoke('quickcart:window:minimize'),
    toggleMaximize: (): Promise<DesktopWindowState> =>
      ipcRenderer.invoke('quickcart:window:toggle-maximize'),
    setKiosk: (enabled: boolean): Promise<DesktopWindowState> =>
      ipcRenderer.invoke('quickcart:window:set-kiosk', enabled),
    close: () => ipcRenderer.invoke('quickcart:window:close'),
    getState: (): Promise<DesktopWindowState> => ipcRenderer.invoke('quickcart:window:get-state'),
    onStateChange: (listener: (state: DesktopWindowState) => void) => {
      const wrapped = (_event: Electron.IpcRendererEvent, state: DesktopWindowState) =>
        listener(state);
      ipcRenderer.on('quickcart:window:state', wrapped);
      return () => ipcRenderer.removeListener('quickcart:window:state', wrapped);
    },
  },
  runtime: {
    getInfo: (): Promise<DesktopRuntimeInfo> => ipcRenderer.invoke('quickcart:runtime:info'),
  },
  printer: {
    list: () => ipcRenderer.invoke('quickcart:printer:list'),
    printReceipt: (
      payload: ThermalReceiptPayload,
      deviceName?: string,
    ): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('quickcart:printer:print-receipt', payload, deviceName),
  },
  drawer: {
    open: (): Promise<{ ok: boolean; commandHex: string; timestamp: string }> =>
      ipcRenderer.invoke('quickcart:drawer:open'),
  },
};

contextBridge.exposeInMainWorld('quickcartDesktop', desktopBridge);
