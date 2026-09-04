import { ipcRenderer } from 'electron'
import type {
  PtyClaimOwnerWindowResult,
  PtyWindowOwnershipEntry
} from '../../shared/pty-window-ownership'
import type { PreloadApi } from '../api-types'

/** Multi-window: which window a PTY delivers to, and moving a tab's PTYs to another workspace. */
export const ptyWindowOwnershipApi = {
  rehomeTabWorktree: (tabId: string, worktreeId: string): Promise<{ rehomedPtyIds: string[] }> =>
    ipcRenderer.invoke('pty:rehomeTabWorktree', { tabId, worktreeId }),
  getWindowOwnership: (): Promise<PtyWindowOwnershipEntry[]> =>
    ipcRenderer.invoke('pty:getWindowOwnership'),
  claimOwnerWindow: (id: string): Promise<PtyClaimOwnerWindowResult> =>
    ipcRenderer.invoke('pty:claimOwnerWindow', { id }),
  /** Per-window view of PTY ownership; a pane whose PTY is owned elsewhere is a mirror (shared/pty-window-ownership). */
  onWindowOwnershipChanged: (
    callback: (entries: PtyWindowOwnershipEntry[]) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entries: PtyWindowOwnershipEntry[]) =>
      callback(entries)
    ipcRenderer.on('pty:windowOwnershipChanged', listener)
    return () => ipcRenderer.removeListener('pty:windowOwnershipChanged', listener)
  }
} satisfies Partial<PreloadApi['pty']>
