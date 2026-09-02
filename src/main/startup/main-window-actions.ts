import { app, BrowserWindow, clipboard, dialog, type Tray } from 'electron'
import type { UpdateCheckOptions } from '../../shared/update-status-types'
import { recordCrashBreadcrumb } from '../crash-reporting/crash-breadcrumb-store'
import { recordDurableCrashBreadcrumb } from '../crash-reporting/durable-crash-breadcrumb'
import { checkForUpdatesFromMenu, isQuittingForUpdate } from '../updater'
import {
  createSystemTray,
  setMacMenuBarIconVisible,
  type SystemTrayOptions
} from '../tray/system-tray'
import { ensureAutoUpdaterConfigured } from '../window/attach-main-window-services'
import { focusExistingMainWindow, safelyRevealWindow } from '../window/focus-existing-window'
import { mainProcessState as state } from './main-process-state'
import { loadMainWindow } from '../window/createMainWindow'
import {
  getFocusedOrLastActiveMainWindow,
  getRegisteredMainWindow,
  hasLiveMainWindows,
  sendToWindow
} from '../window/main-window-registry'
import { describeInstallDirAclPoison } from './windows-install-dir-acl-recovery'
import { presentRendererRecoveryPrompt } from '../window/renderer-recovery-prompt'

export type MainWindowOpenOptions = {
  revealOnDidFinishLoad?: boolean
  forceNewWindow?: boolean
  windowId?: string
}

// The window module injects this callback to avoid a cycle between actions and lifecycle code.
let openWindow: (options?: MainWindowOpenOptions) => BrowserWindow
export function setMainWindowOpener(
  opener: (options?: MainWindowOpenOptions) => BrowserWindow
): void {
  openWindow = opener
}

/** A scoped (project) window, or null while quitting or with the multi-window flag off. */
export function openScopedMainWindow(windowId: string): BrowserWindow | null {
  return state.isQuitting || !state.experimentalMultiWindowEnabledAtStartup
    ? null
    : openWindow({ forceNewWindow: true, windowId })
}

/** File ▸ New Window: a second free window with the flag on, the singleton revealed with it off. */
export function openMainWindowFromMenu(): void {
  if (state.isQuitting) {
    return
  }
  openWindow(state.experimentalMultiWindowEnabledAtStartup ? { forceNewWindow: true } : {})
}

// Why: every relay resolves its window now: the one the caller named when it is
// still registered, otherwise the window the user is actually looking at.
export function resolveTargetMainWindow(targetWindow?: BrowserWindow | null): BrowserWindow | null {
  const registeredTarget =
    targetWindow && !targetWindow.isDestroyed() ? getRegisteredMainWindow(targetWindow) : null
  return registeredTarget ?? getFocusedOrLastActiveMainWindow()
}

export function resolveMenuTargetMainWindow(
  targetWindow?: Electron.BaseWindow | null
): BrowserWindow | null {
  return resolveTargetMainWindow(targetWindow instanceof BrowserWindow ? targetWindow : null)
}

export function sendToTargetMainWindow(
  targetWindow: Electron.BaseWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  const target = resolveMenuTargetMainWindow(targetWindow)
  if (target) {
    sendToWindow(target, channel, ...args)
  }
}

/** Automations render into one window: the preferred one, else whichever the user is looking at. */
export function updateAutomationWindow(preferredWindow?: BrowserWindow | null): void {
  const targetWindow = resolveTargetMainWindow(preferredWindow)
  const webContentsDestroyed =
    targetWindow &&
    typeof targetWindow.webContents.isDestroyed === 'function' &&
    targetWindow.webContents.isDestroyed()
  if (!targetWindow || webContentsDestroyed) {
    state.automations?.setWebContents(null)
    return
  }
  state.automations?.setWebContents(targetWindow.webContents)
}

export function focusExistingWindow(): void {
  if (state.isQuitting) {
    return
  }
  focusExistingMainWindow({
    app,
    getWindow: getFocusedOrLastActiveMainWindow,
    openWindow,
    warn: console.warn
  })
}

export function showMainWindowFromTray(): void {
  const targetWindow = getFocusedOrLastActiveMainWindow()
  if (targetWindow && !targetWindow.isDestroyed()) {
    safelyRevealWindow(targetWindow)
    return
  }
  if (!state.isQuitting && !isQuittingForUpdate()) {
    openWindow()
  }
}

export function openSettingsFromSystemMenu(targetBaseWindow?: Electron.BaseWindow | null): void {
  showMainWindowFromTray()
  const targetWindow = resolveMenuTargetMainWindow(targetBaseWindow)
  if (!targetWindow) {
    return
  }
  recordCrashBreadcrumb('settings_opened')
  targetWindow.webContents.send('ui:openSettings')
  state.pendingOpenSettings.mark(targetWindow.webContents.id, Number.POSITIVE_INFINITY)
}

/** Window > Recover Terminal: the focused renderer re-runs the terminal recovery sequence.
 *  No pending-intent latch — with no mounted renderer there is nothing to recover. */
export function recoverTerminalFromSystemMenu(targetBaseWindow?: Electron.BaseWindow | null): void {
  const targetWindow = resolveMenuTargetMainWindow(targetBaseWindow)
  if (!targetWindow) {
    return
  }
  targetWindow.webContents.send('ui:recoverTerminal')
}

export function quitFromSystemTray(): void {
  if (hasLiveMainWindows()) {
    // Why: a hidden session may veto shutdown with a save/discard prompt, so make the window visible.
    showMainWindowFromTray()
  }
  state.isQuitting = true
  app.quit()
}

export function runUserInitiatedUpdateCheck(options?: UpdateCheckOptions): void {
  ensureAutoUpdaterConfigured()
  checkForUpdatesFromMenu(options)
}

export function getSystemTrayOptions(): SystemTrayOptions | null {
  const store = state.store
  if (!store) {
    return null
  }
  return {
    appIcon: store.getSettings().appIcon,
    isDevInstance: state.devInstanceIdentity?.isDev ?? false,
    devInstanceLabel: state.devInstanceIdentity?.devLabel ?? null,
    onOpen: showMainWindowFromTray,
    onOpenSettings: () => openSettingsFromSystemMenu(),
    onCheckForUpdates: () => {
      showMainWindowFromTray()
      runUserInitiatedUpdateCheck()
    },
    onQuit: quitFromSystemTray
  }
}

export function syncMacMenuBarIcon(showMenuBarIcon: boolean): Tray | null {
  if (process.platform !== 'darwin' || state.isServeMode) {
    return null
  }
  const options = getSystemTrayOptions()
  return options ? setMacMenuBarIconVisible(showMenuBarIcon, options) : null
}

export function createSystemTrayDeferred(
  window: BrowserWindow,
  onCreated?: () => void
): () => void {
  let trayCreated = false
  return () => {
    if (trayCreated || window.isDestroyed() || state.isQuitting || !state.store) {
      return
    }
    trayCreated = true
    if (process.platform === 'darwin') {
      if (syncMacMenuBarIcon(state.store.getSettings().showMenuBarIcon !== false)) {
        onCreated?.()
      }
      return
    }
    const options = getSystemTrayOptions()
    if (options && createSystemTray(options)) {
      onCreated?.()
    }
  }
}

export function sendOpenFeatureTour(targetWindow?: BrowserWindow | null): void {
  const window = resolveTargetMainWindow(targetWindow)
  if (window) {
    sendToWindow(window, 'ui:openFeatureTour')
  }
}

export function sendOpenSetupGuide(targetWindow?: BrowserWindow | null): void {
  const window = resolveTargetMainWindow(targetWindow)
  if (window) {
    sendToWindow(window, 'ui:openSetupGuide')
  }
}

export function sendOpenCrashReport(targetWindow?: BrowserWindow | null): void {
  const window = resolveTargetMainWindow(targetWindow)
  if (window) {
    sendToWindow(window, 'ui:openCrashReport')
  }
}

// Why: on renderer crash-loop the breaker stops auto-reloading and the window goes blank, so a main-process dialog is the only retry/quit surface.
export async function showRendererRecoveryPrompt(recentRecoveryCount: number): Promise<void> {
  await presentRendererRecoveryPrompt({
    recentRecoveryCount,
    isQuitting: () => state.isQuitting,
    diagnose: describeInstallDirAclPoison,
    showMessageBox: (options) => {
      const window = getFocusedOrLastActiveMainWindow() ?? undefined
      return window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
    },
    copyToClipboard: (text) => clipboard.writeText(text),
    reload: () => {
      const reloadTarget = getFocusedOrLastActiveMainWindow()
      if (!reloadTarget) {
        return
      }
      recordDurableCrashBreadcrumb('renderer_recovery_manual_retry')
      // Why: leave the breaker open so a re-crash re-raises this prompt instead of resuming the auto-reload loop.
      loadMainWindow(reloadTarget)
    },
    quit: () => {
      state.isQuitting = true
      app.quit()
    }
  })
}
