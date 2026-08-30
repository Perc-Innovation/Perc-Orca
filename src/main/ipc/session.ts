import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../../shared/workspace-session-state-types'

/** Structured-clone cannot carry a Set, so the window sends its owned worktrees as an array. */
function toOwnedWorktreeIds(value: unknown): ReadonlySet<string> | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0)
  return ids.length > 0 ? new Set(ids) : undefined
}

export function registerSessionHandlers(store: Store): void {
  // Why: hostId is an optional second arg so an older renderer that invokes
  // these channels without it keeps reading/writing the 'local' partition
  // exactly as before. Channel names stay stable.
  ipcMain.handle('session:get', (_event, hostId?: string | null) => {
    return store.getWorkspaceSession(hostId)
  })

  // Why the third arg is optional too: a window that declares no owned worktrees is the shared
  // writer and its write replaces the session whole, exactly as before scoped windows existed.
  ipcMain.handle(
    'session:set',
    (_event, args: WorkspaceSessionState, hostId?: string | null, ownedWorktreeIds?: unknown) => {
      store.setWorkspaceSession(args, hostId, toOwnedWorktreeIds(ownedWorktreeIds))
    }
  )

  ipcMain.handle(
    'session:patch',
    (_event, args: WorkspaceSessionPatch, hostId?: string | null, ownedWorktreeIds?: unknown) => {
      store.patchWorkspaceSession(args, hostId, toOwnedWorktreeIds(ownedWorktreeIds))
    }
  )

  ipcMain.handle('session:flush', () => {
    // Why: durable lifecycle RPCs must propagate disk failures instead of
    // returning success through Store.flush(), which intentionally only logs.
    store.flushOrThrow()
  })

  // Synchronous variant for the renderer's beforeunload handler.
  // sendSync blocks the renderer until this returns, guaranteeing the
  // data (including terminal scrollback buffers) is persisted to disk
  // before the window closes — regardless of before-quit ordering.
  ipcMain.on(
    'session:set-sync',
    (event, args: WorkspaceSessionState, hostId?: string | null, ownedWorktreeIds?: unknown) => {
      store.setWorkspaceSession(args, hostId, toOwnedWorktreeIds(ownedWorktreeIds))
      store.flush()
      event.returnValue = true
    }
  )

  ipcMain.on(
    'session:read-terminal-scrollback-sync',
    (event, args: { ref?: unknown } | undefined) => {
      event.returnValue =
        typeof args?.ref === 'string' ? store.readTerminalScrollbackSnapshot(args.ref) : null
    }
  )
}
