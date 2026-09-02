import { app, type BrowserWindow } from 'electron'
import { createMainWindow, loadMainWindow } from '../window/createMainWindow'
import {
  recordCrashBreadcrumb,
  recordCoalescedCrashBreadcrumb
} from '../crash-reporting/crash-breadcrumb-store'
import { recordDurableCrashBreadcrumb } from '../crash-reporting/durable-crash-breadcrumb'
import { shouldRecoverRendererAfterProcessGone } from '../crash-reporting/process-gone-classification'
import { resolveConsent } from '../telemetry/consent'
import { trackAppOpenedOnce } from '../telemetry/client'
import { ensureWindowsUserDataAclGrant } from './windows-user-data-acl'
import { probeWindowsInstallDirAcl } from './windows-install-dir-acl-probe'
import { startWindowsInstallDirAclRepairIfPoisoned } from './windows-install-dir-acl-recovery'
import { logStartupMilestone } from './startup-diagnostics'
import { notifyMainWindowBecameVisible } from '../window/main-window-visibility'
import { setTrayAttention } from '../tray/system-tray'
import {
  createSystemTrayDeferred,
  getSystemTrayOptions,
  showMainWindowFromTray,
  showRendererRecoveryPrompt,
  syncMacMenuBarIcon
} from './main-window-actions'
import { attachMainWindowCoreServices } from './main-window-core-services'
import {
  clearMainWindowAgentStatusListeners,
  installMainWindowAgentStatusListeners
} from './main-window-agent-status'
import { mainProcessState as state } from './main-process-state'
import {
  clearExpectedRendererReload,
  markExpectedRendererReload,
  markRecoveryReloadInFlight,
  getExpectedTeardownScope,
  recordProcessGoneCrash
} from './main-window-lifecycle-flags'
import { presentGpuFallbackRecoveredLaunchPrompt } from './gpu-lifecycle'
import { maybeAutoRenameBranchOnFirstWorkFromHook } from './branch-rename-hook'
import {
  resumeSyntheticTitleSpinnerTimer,
  stopSyntheticTitleSpinnerTimer
} from './synthetic-title-runtime'
import { requireMainWindowServices } from './main-window-service-readiness'
import {
  getFocusedOrLastActiveMainWindow,
  hasLiveMainWindows,
  registerMainWindow
} from '../window/main-window-registry'
import {
  revealExistingMainWindow,
  shouldReuseExistingMainWindow
} from '../window/main-window-open-policy'
import { removeTrustedBrowserRendererWebContentsId } from '../ipc/browser-renderer-trust'
import {
  abortQuitConfirmationTransaction,
  isQuitConfirmationCollecting,
  onQuitWindowCloseConfirmed
} from './main-process-quit-confirmation'
import { updateAutomationWindow } from './main-window-actions'

const TRAY_CREATE_FALLBACK_MS = 12_000
const AGENT_STATE_CRASH_BREADCRUMB_MIN_INTERVAL_MS = 30_000

export function openMainWindow(
  options: {
    revealOnDidFinishLoad?: boolean
    forceNewWindow?: boolean
    windowId?: string
  } = {}
): BrowserWindow {
  logStartupMilestone('open-main-window-start')
  if (state.isQuitting) {
    throw new Error('Cannot open a main window while Orca is quitting')
  }
  const existingWindow = getFocusedOrLastActiveMainWindow()
  if (
    existingWindow &&
    shouldReuseExistingMainWindow({
      experimentalMultiWindowEnabledAtStartup: state.experimentalMultiWindowEnabledAtStartup,
      forceNewWindow: options.forceNewWindow,
      existingWindow
    })
  ) {
    // Why: with the flag off, every open path must preserve Orca's singleton-window
    // behavior even if a caller reaches this function after startup.
    return revealExistingMainWindow(existingWindow)
  }
  const { store, keybindings } = requireMainWindowServices({
    store: state.store,
    runtime: state.runtime,
    stats: state.stats,
    claudeUsage: state.claudeUsage,
    codexUsage: state.codexUsage,
    openCodeUsage: state.openCodeUsage,
    rateLimits: state.rateLimits,
    automations: state.automations,
    codexAccounts: state.codexAccounts,
    codexRuntimeHome: state.codexRuntimeHome,
    claudeAccounts: state.claudeAccounts,
    claudeRuntimeAuth: state.claudeRuntimeAuth,
    keybindings: state.keybindings
  })
  if (process.platform === 'win32') {
    logStartupMilestone('acl-grant-start')
    ensureWindowsUserDataAclGrant(app.getPath('userData'), {
      onDone: (result) => {
        logStartupMilestone('acl-grant-done', { mode: result.mode })
        if (result.mode === 'failed') {
          console.warn('[win32-acl] userData ACL grant failed:', result.reason)
        }
      }
    })
    // Why here: read-only, and the install DACL is the one thing a 0x80000003
    // child death cannot tell us about itself. See electron/electron#51761.
    probeWindowsInstallDirAcl({
      isServeMode: state.isServeMode,
      onDone: (data) =>
        startWindowsInstallDirAclRepairIfPoisoned(data, {
          isServeMode: state.isServeMode,
          userDataPath: app.getPath('userData'),
          appVersion: app.getVersion()
        })
    })
  }
  const window = createMainWindow(store, {
    getIsQuitting: () => state.isQuitting,
    onQuitAborted: abortQuitConfirmationTransaction,
    isQuitConfirmationCollecting,
    onQuitWindowCloseConfirmed,
    onRendererProcessGone: (details, webContentsId) =>
      recordProcessGoneCrash(
        'renderer',
        'renderer',
        details.reason,
        details.exitCode ?? null,
        { processType: 'renderer' },
        webContentsId
      ),
    shouldRecoverRenderer: (details, webContentsId) =>
      shouldRecoverRendererAfterProcessGone({
        reason: details.reason,
        expectedTeardown: getExpectedTeardownScope(webContentsId, false)
      }),
    onRendererRecoveryExhausted: ({ details, recentRecoveryCount }) => {
      recordDurableCrashBreadcrumb('renderer_recovery_circuit_breaker_open', {
        reason: details.reason,
        exitCode: details.exitCode ?? null,
        recentRecoveryCount
      })
      void showRendererRecoveryPrompt(recentRecoveryCount)
    },
    deferLoad: true,
    ...(options.revealOnDidFinishLoad === true ? { revealOnDidFinishLoad: true } : {}),
    ...(options.windowId ? { windowId: options.windowId } : {}),
    title: state.devInstanceIdentity?.name ?? app.name,
    getKeybindings: () => keybindings.getOverrides(),
    onBeforeReload: ({ ignoreCache, webContentsId }) => {
      markExpectedRendererReload(webContentsId)
      recordCrashBreadcrumb('manual_reload_requested', { ignoreCache })
    },
    onBeforeRecoveryReload: (webContentsId) => {
      markRecoveryReloadInFlight(webContentsId)
      recordDurableCrashBreadcrumb('renderer_recovery_reload')
    }
  })
  registerMainWindow(window)
  recordCrashBreadcrumb('main_window_created')
  logStartupMilestone('window-created')
  const createTray = createSystemTrayDeferred(window, () => logStartupMilestone('tray-created'))
  window.once('ready-to-show', () => {
    logStartupMilestone('ready-to-show')
    setImmediate(createTray)
  })
  window.once('show', () => {
    logStartupMilestone('window-shown')
    void presentGpuFallbackRecoveredLaunchPrompt(window)
  })
  const trayCreateFallback = setTimeout(createTray, TRAY_CREATE_FALLBACK_MS)
  trayCreateFallback.unref?.()
  const rendererWebContentsId = window.webContents.id
  const onFirstWindowLoad = (): void => {
    clearExpectedRendererReload(rendererWebContentsId)
    recordCrashBreadcrumb('main_window_loaded')
    logStartupMilestone('did-finish-load')
    // Why cleared here: a reload drops the old ui:openMarkdownFiles listener, and the fresh
    // renderer re-attaches by pulling. Pushing into the gap between would be silently lost.
    state.markdownFileOpenListenerReady = false
    const currentStore = state.store
    if (currentStore && resolveConsent(currentStore.getSettings()).effective === 'enabled') {
      trackAppOpenedOnce()
    }
  }
  window.webContents.on('did-finish-load', onFirstWindowLoad)
  attachMainWindowCoreServices(window, {
    markExpectedRendererReload,
    recordRendererReload: (ignoreCache) =>
      recordCrashBreadcrumb('renderer_reload_requested', { ignoreCache })
  })
  state.mainWindow = window
  window.on('focus', () => {
    updateAutomationWindow(window)
    resumeSyntheticTitleSpinnerTimer()
  })
  window.on('show', resumeSyntheticTitleSpinnerTimer)
  window.on('restore', resumeSyntheticTitleSpinnerTimer)
  window.on('hide', stopSyntheticTitleSpinnerTimer)
  window.on('minimize', stopSyntheticTitleSpinnerTimer)
  window.on('show', notifyMainWindowBecameVisible)
  window.on('restore', notifyMainWindowBecameVisible)
  window.on('show', () => setTrayAttention(false))
  window.on('restore', () => setTrayAttention(false))
  installMainWindowAgentStatusListeners({
    window,
    maybeAutoRenameBranchOnFirstWork: maybeAutoRenameBranchOnFirstWorkFromHook,
    onRecordAgentState: (agentType, status) =>
      recordCoalescedCrashBreadcrumb({
        name: 'agent_state_changed',
        data: { agentType, state: status },
        coalesceKey: `agent:${agentType}:${status}`,
        minIntervalMs: AGENT_STATE_CRASH_BREADCRUMB_MIN_INTERVAL_MS
      })
  })
  window.on('closed', () => {
    if (state.mainWindow === window) {
      // Why fall back rather than null: another window may still be up, and the callers that
      // read this field want "a live main window", not "the one that just went away".
      state.mainWindow = getFocusedOrLastActiveMainWindow()
    }
    clearExpectedRendererReload(rendererWebContentsId)
    removeTrustedBrowserRendererWebContentsId(rendererWebContentsId)
    updateAutomationWindow()
    if (!hasLiveMainWindows()) {
      // Why: app-global hook services outlive macOS no-window gaps, but their
      // renderer endpoints must clear when no window can receive status frames.
      clearMainWindowAgentStatusListeners()
    }
  })
  logStartupMilestone('load-start')
  loadMainWindow(window)
  return window
}

export function configureWindowActions(): void {
  // Kept as a named seam for startup composition; action callbacks are state-backed.
  void getSystemTrayOptions
  void showMainWindowFromTray
  void syncMacMenuBarIcon
}
