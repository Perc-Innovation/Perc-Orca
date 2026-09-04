import type { BrowserWindow } from 'electron'
import type { CreateWorktreeResult } from '../../shared/worktree/create-types'
import type { WorktreeStartupLaunch } from '../../shared/worktree/launch-types'
import type {
  RuntimeMarkdownReadTabResult,
  RuntimeMarkdownSaveTabResult
} from '../../shared/mobile-markdown-document'
import type { RuntimeMobileSessionTabMove } from '../../shared/runtime-types'
import { runWorktreeChangeInvalidators } from '../ipc/worktree-change-invalidators'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { getFocusedOrLastActiveMainWindow, getMainWindowById } from './main-window-registry'
import { requestMobileMarkdownFromRenderer } from './mobile-markdown-request-relay'
import { registerRendererDocumentNavigation } from './renderer-document-navigation'
import { createRuntimeRendererNotificationSender } from './runtime-renderer-notification-sender'
import {
  broadcastRuntimeWindowNotification,
  getPreferredRuntimeWindowNotifier,
  getRuntimeWindowNotifierById,
  hasRuntimeWindowNotifiers,
  registerRuntimeWindowNotifier,
  resolveRuntimeWindowNotifier,
  unregisterRuntimeWindowNotifier
} from './runtime-window-notifier-registry'
import { requestSessionTabCloseFromRenderer } from './session-tab-close-request-relay'
import { requestTerminalTabCloseFromRenderer } from './terminal-tab-close-request-relay'
import { relayTerminalRevealToWindow } from './terminal-reveal-window-relay'

/**
 * The runtime notifier is app-global while windows come and go, so every relay picks its
 * target now: the window that owns the pane, the one in front, or all of them. A single
 * "current window" notifier would send a project window's terminal events to whichever
 * window registered last.
 */
export function registerRuntimeWindowLifecycle(
  mainWindow: BrowserWindow,
  runtime: OrcaRuntimeService
): void {
  runtime.attachWindow(mainWindow.id)
  const mainWebContents = mainWindow.webContents
  const rendererNotifications = createRuntimeRendererNotificationSender({
    isWindowDestroyed: () => mainWindow.isDestroyed(),
    webContents: mainWebContents,
    onFailure: (reason) => runtime.markGraphReloadFailed(mainWindow.id, reason)
  })
  registerRuntimeWindowNotifier({ window: mainWindow, send: rendererNotifications.send })
  // Why: the notifier is app-global while windows come and go, so every relay picks
  // its target now: the window that owns the pane, the one in front, or all of them.
  const sendToOwner = (
    ownerWindowId: number | null,
    channel: string,
    ...values: unknown[]
  ): boolean => getRuntimeWindowNotifierById(ownerWindowId)?.send(channel, ...values) ?? false
  const sendToOwnerOrTarget = (
    ownerWindowId: number | null,
    channel: string,
    ...values: unknown[]
  ): boolean => resolveRuntimeWindowNotifier(ownerWindowId)?.send(channel, ...values) ?? false
  const send = (channel: string, ...values: unknown[]): boolean =>
    getPreferredRuntimeWindowNotifier()?.send(channel, ...values) ?? false
  const broadcast = (channel: string, ...values: unknown[]): void =>
    broadcastRuntimeWindowNotification(channel, ...values)
  const ownerWindowOrPreferred = (ownerWindowId: number | null): BrowserWindow | null =>
    (ownerWindowId === null ? null : getMainWindowById(ownerWindowId)) ??
    getFocusedOrLastActiveMainWindow()
  runtime.setNotifier({
    worktreesChanged: (repoId, renamed) => {
      // Why: clear scan caches before the renderer handles this event, so it can't read stale TTL entries after a mutation.
      runWorktreeChangeInvalidators(repoId)
      broadcast('worktrees:changed', renamed ? { repoId, renamed } : { repoId })
    },
    worktreeBaseStatus: (event) => broadcast('worktree:baseStatus', event),
    worktreeRemoteBranchConflict: (event) => broadcast('worktree:remoteBranchConflict', event),
    reposChanged: () => broadcast('repos:changed'),
    automationsChanged: (payload) => broadcast('automations:changed', payload),
    activateWorktree: (
      repoId,
      worktreeId,
      setup?: CreateWorktreeResult['setup'],
      startup?: WorktreeStartupLaunch,
      defaultTabs?: CreateWorktreeResult['defaultTabs']
    ) => {
      send('ui:activateWorktree', {
        repoId,
        worktreeId,
        ...(setup ? { setup } : {}),
        ...(startup ? { startup } : {}),
        ...(defaultTabs ? { defaultTabs } : {})
      })
    },
    createTerminal: (worktreeId, opts) =>
      send('ui:createTerminal', {
        worktreeId,
        command: opts.command,
        ...(opts.cwd ? { cwd: opts.cwd } : {}),
        ...(opts.env ? { env: opts.env } : {}),
        title: opts.title,
        ...(opts.presentation ? { presentation: opts.presentation } : {})
      }),
    revealTerminalSession: (worktreeId, opts) =>
      relayTerminalRevealToWindow(runtime, worktreeId, opts, {
        resolveTargetWindow: ownerWindowOrPreferred,
        sendToOwner
      }),
    resolveLegacyWorkerTerminalRecovery: (paneKey, resolution, ptyId) =>
      send('agentStatus:legacyWorkerTerminalRecovery', {
        paneKey,
        resolution,
        ...(ptyId ? { ptyId } : {})
      }),
    splitTerminal: (tabId, paneRuntimeId, opts) => {
      sendToOwner(runtime.resolveOwnerWindowIdForTabId(tabId), 'ui:splitTerminal', {
        tabId,
        paneRuntimeId,
        direction: opts.direction,
        command: opts.command,
        worktreeId: opts.worktreeId,
        sourceLeafId: opts.sourceLeafId,
        telemetrySource: opts.telemetrySource,
        newLeafId: opts.newLeafId
      })
    },
    renameTerminal: (tabId, title) =>
      sendToOwner(runtime.resolveOwnerWindowIdForTabId(tabId), 'ui:renameTerminal', {
        tabId,
        title
      }),
    focusTerminal: (tabId, worktreeId, leafId) =>
      sendToOwner(
        leafId
          ? runtime.resolveOwnerWindowIdForLeaf(tabId, leafId)
          : runtime.resolveOwnerWindowIdForWorktreeTab(worktreeId, tabId),
        'ui:focusTerminal',
        { tabId, worktreeId, leafId }
      ),
    focusEditorTab: (tabId, worktreeId) =>
      sendToOwner(
        runtime.resolveOwnerWindowIdForWorktreeTab(worktreeId, tabId),
        'ui:focusEditorTab',
        { tabId, worktreeId }
      ),
    closeSessionTab: (tabId, worktreeId) =>
      requestSessionTabCloseFromRenderer(
        requireOwnerWindow(runtime.resolveOwnerWindowIdForWorktreeTab(worktreeId, tabId)),
        tabId,
        worktreeId
      ),
    moveSessionTab: (worktreeId: string, move: RuntimeMobileSessionTabMove) =>
      sendToOwner(
        runtime.resolveOwnerWindowIdForWorktreeTab(worktreeId, move.tabId),
        'ui:moveSessionTab',
        { worktreeId, ...move }
      ),
    openFile: (worktreeId, filePath, relativePath, runtimeEnvironmentId?) =>
      send('ui:openFileFromMobile', {
        worktreeId,
        filePath,
        relativePath,
        runtimeEnvironmentId
      }),
    openDiff: (worktreeId, filePath, relativePath, staged, runtimeEnvironmentId?) =>
      send('ui:openDiffFromMobile', {
        worktreeId,
        filePath,
        relativePath,
        staged,
        runtimeEnvironmentId
      }),
    readMobileMarkdownTab: (worktreeId, tabId) =>
      requestMobileMarkdownFromRenderer(
        requireOwnerWindow(runtime.resolveOwnerWindowIdForWorktreeTab(worktreeId, tabId)),
        {
          operation: 'read',
          worktreeId,
          tabId
        }
      ) as Promise<RuntimeMarkdownReadTabResult>,
    saveMobileMarkdownTab: (worktreeId, tabId, baseVersion, content) =>
      requestMobileMarkdownFromRenderer(
        requireOwnerWindow(runtime.resolveOwnerWindowIdForWorktreeTab(worktreeId, tabId)),
        {
          operation: 'save',
          worktreeId,
          tabId,
          baseVersion,
          content
        }
      ) as Promise<RuntimeMarkdownSaveTabResult>,
    closeTerminal: (tabId, paneRuntimeId) =>
      sendToOwner(runtime.resolveOwnerWindowIdForTabId(tabId), 'ui:closeTerminal', {
        tabId,
        paneRuntimeId
      }),
    closeTerminalTab: (tabId, options) =>
      requestTerminalTabCloseFromRenderer(
        requireOwnerWindow(runtime.resolveOwnerWindowIdForTabId(tabId)),
        tabId,
        options
      ),
    sleepWorktree: (worktreeId) => send('ui:sleepWorktree', { worktreeId }),
    resumeSleepingAgents: (worktreeId) => send('ui:resumeSleepingAgents', { worktreeId }),
    terminalFitOverrideChanged: (ptyId, mode, cols, rows) =>
      sendToOwnerOrTarget(
        runtime.resolveOwnerWindowIdForPtyId(ptyId),
        'runtime:terminalFitOverrideChanged',
        { ptyId, mode, cols, rows }
      ),
    terminalDriverChanged: (ptyId, driver) =>
      sendToOwnerOrTarget(
        runtime.resolveOwnerWindowIdForPtyId(ptyId),
        'runtime:terminalDriverChanged',
        { ptyId, driver }
      ),
    nativeChatLaunchDraftResolved: (tabId, resolution) =>
      sendToOwnerOrTarget(
        runtime.resolveOwnerWindowIdForTabId(tabId),
        'runtime:nativeChatLaunchDraftResolved',
        { tabId, ...resolution }
      ),
    browserDriverChanged: (browserPageId, driver) =>
      sendToOwnerOrTarget(
        runtime.resolveOwnerWindowIdForBrowserPageId(browserPageId),
        'runtime:browserDriverChanged',
        { browserPageId, driver }
      ),
    browserRemoteViewersChanged: (browserPageId, hasRemoteViewers) =>
      sendToOwnerOrTarget(
        runtime.resolveOwnerWindowIdForBrowserPageId(browserPageId),
        'runtime:browserRemoteViewersChanged',
        { browserPageId, hasRemoteViewers }
      ),
    // Why broadcast: client-hosted browser rows are a catalog every window lists, not one pane's state.
    clientHostedBrowserRowsChanged: (event) =>
      broadcast('runtime:clientHostedBrowserRowsChanged', event)
  })
  registerRendererDocumentNavigation(mainWebContents, () => {
    rendererNotifications.onMainFrameReloadStarted()
    const fence = runtime.markRendererReloading(mainWindow.id)
    return () => {
      if (fence && runtime.markRendererReloadCancelled(mainWindow.id, fence)) {
        rendererNotifications.onMainFrameReloadCancelled()
      }
    }
  })
  mainWebContents.on('did-finish-load', () => {
    rendererNotifications.onMainFrameLoadFinished()
  })
  mainWebContents.on('render-process-gone', () => {
    rendererNotifications.onRendererProcessGone()
  })
  mainWindow.on('closed', () => {
    rendererNotifications.close()
    unregisterRuntimeWindowNotifier(mainWindow.id)
    runtime.markGraphUnavailable(mainWindow.id)
    if (!hasRuntimeWindowNotifiers()) {
      // Why: the notifier routes through the live window registry; keep it installed
      // while any window remains and clear it only during no-window gaps.
      runtime.setNotifier(null)
    }
  })
}

// Why: a relay that must target one window has no meaningful fallback — reporting
// the runtime as unavailable is better than acting on a different window's tab.
function requireOwnerWindow(ownerWindowId: number | null): BrowserWindow {
  const window = ownerWindowId === null ? null : getMainWindowById(ownerWindowId)
  if (!window) {
    throw new Error('runtime_unavailable')
  }
  return window
}
