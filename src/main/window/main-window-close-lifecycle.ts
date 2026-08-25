import { ipcMain, Notification, type BrowserWindow } from 'electron'
import { translateMain } from '../i18n/main-i18n'
import type { Store } from '../persistence'
import { resolveWindowCloseAction } from './window-close-decision'
import type { CreateMainWindowOptions } from './main-window-contracts'
import type { MainWindowFocusLifecycle } from './main-window-focus-lifecycle'
import type { MainWindowStateLifecycle } from './main-window-state-lifecycle'
import { syncTrafficLightPosition } from './main-window-visual-lifecycle'
import {
  clearHideToTrayRequest,
  registerWindowControlIpcHandlers,
  setHideToTrayRequest
} from './window-control-ipc-handlers'

export const WINDOW_QUIT_RENDERER_ACK_TIMEOUT_MS = 10_000

const confirmedCloseByWindow = new WeakMap<BrowserWindow, () => void>()
const quitCloseRequestByWindow = new WeakMap<BrowserWindow, () => boolean>()

/** Closes a window whose renderer already confirmed during a multi-window quit. */
export function closeWindowAfterConfirmation(window: BrowserWindow): void {
  confirmedCloseByWindow.get(window)?.()
}

/** Asks one window's renderer for its quit decision; false when it cannot answer. */
export function requestWindowCloseForQuit(window: BrowserWindow): boolean {
  return quitCloseRequestByWindow.get(window)?.() ?? false
}

export function installMainWindowCloseLifecycle(args: {
  focus: MainWindowFocusLifecycle
  mainWindow: BrowserWindow
  opts?: CreateMainWindowOptions
  rendererWebContentsId: number
  state: MainWindowStateLifecycle
  store: Store | null
}): { dispose: () => void } {
  const { focus, mainWindow, opts, rendererWebContentsId, state, store } = args
  registerWindowControlIpcHandlers()
  // Intercept close so the renderer can confirm killing running-process terminals (replies window:confirm-close to proceed).
  let windowCloseConfirmed = false
  let pendingQuitCloseRequest = false
  const confirmCloseChannel = 'window:confirm-close'
  const cancelCloseChannel = 'window:cancel-close'
  const closeRequestReceivedChannel = 'window:close-request-received'
  let closeRequestSequence = 0
  let quitRendererAckRequestId: number | null = null
  let quitRendererAckTimer: ReturnType<typeof setTimeout> | null = null
  const clearQuitRendererAckTimer = (): void => {
    quitRendererAckRequestId = null
    if (quitRendererAckTimer) {
      clearTimeout(quitRendererAckTimer)
      quitRendererAckTimer = null
    }
  }
  const armQuitRendererAckTimer = (requestId: number): void => {
    quitRendererAckRequestId = requestId
    if (quitRendererAckTimer) {
      return
    }
    // Why: will-quit cannot run until the renderer-backed window closes; an
    // already-frozen renderer otherwise makes Force Quit the only escape.
    quitRendererAckTimer = setTimeout(() => {
      quitRendererAckTimer = null
      quitRendererAckRequestId = null
      if (mainWindow.isDestroyed()) {
        return
      }
      console.warn('[window] Renderer did not acknowledge quit; destroying unresponsive window')
      state.freezeBoundsOnQuit()
      mainWindow.destroy()
    }, WINDOW_QUIT_RENDERER_ACK_TIMEOUT_MS)
    quitRendererAckTimer.unref?.()
  }
  const onCloseRequestReceived = (event: Electron.IpcMainEvent, requestId: number): void => {
    if (event.sender.id === rendererWebContentsId && requestId === quitRendererAckRequestId) {
      clearQuitRendererAckTimer()
    }
  }

  // Windows minimize-to-tray: hide instead of close when enabled; returns true when it hid so callers skip their close path.
  const hideToTrayIfEnabled = (): boolean => {
    const isRendererCrashed = mainWindow.webContents.isCrashed?.() ?? false
    if (
      process.platform !== 'win32' ||
      focus.isRendererProcessGone() ||
      isRendererCrashed ||
      opts?.getIsQuitting?.() === true ||
      store?.getSettings().minimizeToTrayOnClose !== true
    ) {
      return false
    }
    mainWindow.hide()
    // Why: notify once that closing only hid the window; the persisted flag stops it repeating on every later minimize.
    if (store.getUI().trayMinimizeNoticeShown !== true) {
      try {
        new Notification({
          title: 'Orca',
          body: translateMain(
            'tray.minimizeNotice.body',
            'Orca is still running in the system tray'
          )
        }).show()
      } catch {
        // Notification is best-effort — never block hiding the window.
      }
      store.updateUI({ trayMinimizeNoticeShown: true })
    }
    return true
  }
  setHideToTrayRequest(mainWindow, hideToTrayIfEnabled)

  confirmedCloseByWindow.set(mainWindow, () => {
    windowCloseConfirmed = true
    if (!mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  })
  quitCloseRequestByWindow.set(mainWindow, () => {
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed?.() === true) {
      return false
    }
    // Why: a gone/crashed renderer can never answer, so report it as declined and
    // let the quit transaction count this window as already settled.
    if (focus.isRendererProcessGone() || (mainWindow.webContents.isCrashed?.() ?? false)) {
      return false
    }
    pendingQuitCloseRequest = true
    const requestId = ++closeRequestSequence
    armQuitRendererAckTimer(requestId)
    mainWindow.webContents.send('window:close-requested', { isQuitting: true, requestId })
    return true
  })

  mainWindow.on('close', (e) => {
    // Why: Alt+F4/programmatic closes hit the native event; apply the same minimize-to-tray guard the renderer-drawn X uses.
    if (!windowCloseConfirmed && hideToTrayIfEnabled()) {
      e.preventDefault()
      return
    }
    const isRendererCrashed = mainWindow.webContents.isCrashed?.() ?? false
    // Why: only a gone/crashed renderer (can't answer) may bypass close confirmation; a hung-but-alive one still must (#5787).
    const closeAction = resolveWindowCloseAction({
      windowCloseConfirmed,
      rendererProcessGone: focus.isRendererProcessGone(),
      isRendererCrashed
    })
    if (closeAction !== 'request-confirmation') {
      // allow-confirmed: renderer already replied and re-entered close().
      // bypass-gone: a gone renderer can't answer window:close-requested, so let OS close complete rather than trap a blank window.
      if (closeAction === 'allow-confirmed') {
        windowCloseConfirmed = false
      }
      // Why: window teardown emits resize/move/unmaximize; freeze bounds persistence so they can't clobber saved size (v1.3.26-rc2).
      state.freezeBoundsOnQuit()
      return
    }
    e.preventDefault()
    const isQuitting = opts?.getIsQuitting?.() ?? false
    pendingQuitCloseRequest = isQuitting
    const requestId = ++closeRequestSequence
    if (isQuitting) {
      armQuitRendererAckTimer(requestId)
    }
    // Why: renderer owns the close decision; the always-mounted App root subscription lets even pre-workspace states reply (#5144).
    mainWindow.webContents.send('window:close-requested', {
      isQuitting,
      requestId
    })
  })
  mainWindow.webContents.on('will-prevent-unload', () => {
    // Why: a prevented beforeunload cancels the quit; release the bounds-persistence freeze so later resizing still saves.
    state.resumeBoundsPersistence()
    clearQuitRendererAckTimer()
    opts?.onQuitAborted?.()
    mainWindow.webContents.send('window:unload-prevented')
  })

  // Why: every live window listens on the same channels, so each install must
  // ignore replies that belong to another window's renderer.
  const isOwnRenderer = (event: Electron.IpcMainEvent): boolean =>
    event.sender.id === rendererWebContentsId
  const onConfirmClose = (event: Electron.IpcMainEvent): void => {
    if (!isOwnRenderer(event)) {
      return
    }
    clearQuitRendererAckTimer()
    if (opts?.getIsQuitting?.() === true && opts?.isQuitConfirmationCollecting?.() === true) {
      // Why: during a multi-window quit no window may close until every renderer
      // has accepted, or a later veto would leave the app partially torn down.
      pendingQuitCloseRequest = false
      state.freezeBoundsOnQuit()
      opts?.onQuitWindowCloseConfirmed?.(mainWindow)
      return
    }
    if (pendingQuitCloseRequest && opts?.getIsQuitting?.() === true) {
      pendingQuitCloseRequest = false
      windowCloseConfirmed = true
      if (!mainWindow.isDestroyed()) {
        mainWindow.close()
      }
      return
    }
    if (pendingQuitCloseRequest) {
      // Why: another window can cancel the quit while this renderer is still
      // confirming; do not reinterpret that stale reply as a normal close.
      pendingQuitCloseRequest = false
      return
    }
    windowCloseConfirmed = true
    if (!mainWindow.isDestroyed()) {
      mainWindow.close()
    }
  }
  const onCancelClose = (event: Electron.IpcMainEvent): void => {
    if (!isOwnRenderer(event)) {
      return
    }
    if (opts?.getIsQuitting?.() === true && opts?.isQuitConfirmationCollecting?.() === true) {
      pendingQuitCloseRequest = false
      clearQuitRendererAckTimer()
      opts?.onQuitAborted?.()
    }
  }
  const trafficLightChannel = 'ui:sync-traffic-lights'
  const onSyncTrafficLights = (event: Electron.IpcMainEvent, zoomFactor: number): void => {
    if (!isOwnRenderer(event)) {
      return
    }
    syncTrafficLightPosition(mainWindow, zoomFactor)
  }
  ipcMain.on(trafficLightChannel, onSyncTrafficLights)

  ipcMain.on(confirmCloseChannel, onConfirmClose)
  ipcMain.on(cancelCloseChannel, onCancelClose)
  ipcMain.on(closeRequestReceivedChannel, onCloseRequestReceived)

  const dispose = (): void => {
    clearQuitRendererAckTimer()
    ipcMain.removeListener(trafficLightChannel, onSyncTrafficLights)
    ipcMain.removeListener(confirmCloseChannel, onConfirmClose)
    ipcMain.removeListener(cancelCloseChannel, onCancelClose)
    ipcMain.removeListener(closeRequestReceivedChannel, onCloseRequestReceived)
    confirmedCloseByWindow.delete(mainWindow)
    quitCloseRequestByWindow.delete(mainWindow)
    clearHideToTrayRequest(mainWindow)
  }
  return { dispose }
}
