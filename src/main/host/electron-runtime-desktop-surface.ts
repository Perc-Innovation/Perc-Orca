import { BrowserWindow, ipcMain, Notification, webContents } from 'electron'
import { browserManager } from '../browser/browser-manager'
import type { RuntimeDesktopSurface } from '../runtime/runtime-desktop-surface'
import {
  getFocusedOrLastActiveMainWindow,
  getMainWindowForWebContents,
  getMainWindows
} from '../window/main-window-registry'

/** The desktop implementation of the runtime's optional desktop facilities. */
export const electronRuntimeDesktopSurface: RuntimeDesktopSurface = {
  showNotification: ({ title, body }) => {
    if (!Notification.isSupported()) {
      return false
    }
    new Notification({ title, body }).show()
    return true
  },
  findWindowById: (id) => BrowserWindow.fromId(id),
  findFocusedOrLastActiveWindow: () => getFocusedOrLastActiveMainWindow(),
  countLiveWindows: () => getMainWindows().length,
  // Why: a browser tab registers with BrowserManager before it necessarily reaches the
  // runtime graph, so its registering renderer is the authoritative owner lookup.
  findWindowForBrowserPage: (browserPageId) => {
    const rendererWebContentsId = browserManager.getRendererWebContentsId(browserPageId)
    const renderer =
      rendererWebContentsId === null ? null : webContents.fromId(rendererWebContentsId)
    return renderer ? getMainWindowForWebContents(renderer) : null
  },
  onIpc: (channel, listener) => {
    ipcMain.on(channel, listener as Parameters<typeof ipcMain.on>[1])
  },
  removeIpcListener: (channel, listener) => {
    ipcMain.removeListener(channel, listener as Parameters<typeof ipcMain.removeListener>[1])
  }
}
