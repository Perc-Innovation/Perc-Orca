import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type { TerminalTabCreateReply } from '../../shared/terminal-reveal-identity'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RuntimeNotifier } from '../runtime/runtime-notifier-contract'

type RevealTerminalSession = NonNullable<RuntimeNotifier['revealTerminalSession']>
type RevealOptions = Parameters<RevealTerminalSession>[1]
type RevealResult = Awaited<Exclude<ReturnType<RevealTerminalSession>, void>>

/**
 * Asks one renderer window to create (or split into) the pane for a runtime-created PTY and waits
 * for its reply. `resolveTargetWindow` picks the owner window first, so a reveal never lands a
 * tab that another window already renders.
 */
export function relayTerminalRevealToWindow(
  runtime: OrcaRuntimeService,
  worktreeId: string,
  opts: RevealOptions,
  deps: {
    resolveTargetWindow: (ownerWindowId: number | null) => BrowserWindow | null
    sendToOwner: (ownerWindowId: number | null, channel: string, ...values: unknown[]) => boolean
  }
): Promise<RevealResult> {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID()
    const expectedIdentity = opts.expectedProcessIdentity
      ? opts.tabId && opts.leafId
        ? { worktreeId, tabId: opts.tabId, leafId: opts.leafId, ptyId: opts.ptyId }
        : null
      : undefined
    if (expectedIdentity === null) {
      reject(new Error('terminal_reveal_identity_required'))
      return
    }
    // Why: a reveal belongs to whichever window already owns that tab/leaf/PTY;
    // only a genuinely new session may land in the window the user is using.
    const ownerWindowId =
      opts.tabId && opts.splitFromLeafId
        ? runtime.resolveOwnerWindowIdForLeaf(opts.tabId, opts.splitFromLeafId)
        : opts.tabId
          ? (runtime.resolveOwnerWindowIdForWorktreeTab(worktreeId, opts.tabId) ??
            runtime.resolveOwnerWindowIdForTabId(opts.tabId))
          : runtime.resolveOwnerWindowIdForPtyId(opts.ptyId)
    const target = deps.resolveTargetWindow(ownerWindowId)
    if (!target) {
      reject(new Error('runtime_unavailable'))
      return
    }
    const timer = setTimeout(() => {
      ipcMain.removeListener('terminal:tabCreateReply', handler)
      target.removeListener('closed', onTargetClosed)
      reject(new Error('Terminal reveal timed out'))
    }, 10_000)
    const onTargetClosed = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('terminal:tabCreateReply', handler)
      reject(new Error('runtime_unavailable'))
    }
    const handler = (event: Electron.IpcMainEvent, reply: TerminalTabCreateReply): void => {
      // Why: requestId is renderer-supplied, so only the targeted main window may satisfy the reveal.
      if (event.sender !== target.webContents || reply.requestId !== requestId) {
        return
      }
      clearTimeout(timer)
      ipcMain.removeListener('terminal:tabCreateReply', handler)
      target.removeListener('closed', onTargetClosed)
      if (reply.error) {
        reject(new Error(reply.error))
        return
      }
      if (
        expectedIdentity &&
        (!reply.identity ||
          reply.identity.worktreeId !== expectedIdentity.worktreeId ||
          reply.identity.tabId !== expectedIdentity.tabId ||
          reply.identity.leafId !== expectedIdentity.leafId ||
          reply.identity.ptyId !== expectedIdentity.ptyId)
      ) {
        reject(new Error('terminal_reveal_identity_mismatch'))
        return
      }
      resolve({
        tabId: reply.tabId!,
        title: reply.title,
        ...(reply.identity ? { identity: reply.identity } : {})
      })
    }
    ipcMain.on('terminal:tabCreateReply', handler)
    target.once('closed', onTargetClosed)
    // Why: a runtime-created PTY can emit daemon output before the renderer
    // publishes its graph, so stamp the chosen window before adoption.
    runtime.registerPtyOwnerWindow(opts.ptyId, target.id)
    const sent = deps.sendToOwner(target.id, 'ui:createTerminal', {
      requestId,
      worktreeId,
      ptyId: opts.ptyId,
      title: opts.title ?? undefined,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.launchConfig ? { launchConfig: opts.launchConfig } : {}),
      ...(opts.launchToken ? { launchToken: opts.launchToken } : {}),
      ...(opts.launchAgent ? { launchAgent: opts.launchAgent } : {}),
      ...(opts.viewMode ? { viewMode: opts.viewMode } : {}),
      activate: opts.activate !== false,
      ...(opts.presentation ? { presentation: opts.presentation } : {}),
      ...(opts.surfaceOwner === false ? { surfaceOwner: false } : {}),
      // Why: pre-minted tabId aligns the renderer tab id with the paneKey baked into the PTY env, so hook events route right.
      ...(opts.tabId !== undefined ? { tabId: opts.tabId } : {}),
      ...(opts.leafId !== undefined ? { leafId: opts.leafId } : {}),
      ...(opts.splitFromLeafId !== undefined ? { splitFromLeafId: opts.splitFromLeafId } : {}),
      ...(opts.splitDirection !== undefined ? { splitDirection: opts.splitDirection } : {}),
      ...(opts.splitTelemetrySource !== undefined
        ? { splitTelemetrySource: opts.splitTelemetrySource }
        : {}),
      ...(opts.focus !== undefined ? { focus: opts.focus } : {})
    })
    if (!sent) {
      clearTimeout(timer)
      ipcMain.removeListener('terminal:tabCreateReply', handler)
      target.removeListener('closed', onTargetClosed)
      reject(new Error('runtime_unavailable'))
    }
  })
}
