import { getPtyIpc } from '../../pty-host-bindings'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import { isValidTerminalTabId } from '../../../../shared/terminal-tab-id'

export function installPtyRehomeTabWorktreeHandler(deps: { runtime?: OrcaRuntimeService }): void {
  const ipcMain = getPtyIpc()
  const { runtime } = deps
  ipcMain.removeHandler('pty:rehomeTabWorktree')
  ipcMain.handle(
    'pty:rehomeTabWorktree',
    async (
      _event,
      args: { tabId: string; worktreeId: string }
    ): Promise<{ rehomedPtyIds: string[] }> => {
      // Why: the renderer owns which workspaces a tab may move between (execution
      // host, catalog); main only re-keys what it already tracks for that tab.
      if (!args?.tabId || !args?.worktreeId || !isValidTerminalTabId(args.tabId)) {
        return { rehomedPtyIds: [] }
      }
      return (
        runtime?.rehomeTerminalTabWorktree(args.tabId, args.worktreeId) ?? { rehomedPtyIds: [] }
      )
    }
  )
}
