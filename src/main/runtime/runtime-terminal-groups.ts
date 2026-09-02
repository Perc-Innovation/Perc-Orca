import type { Repo } from '../../shared/repo-types'
import type { Worktree } from '../../shared/worktree/types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { isFolderRepo } from '../../shared/repo-kind'
import { isWorkspaceInstanceWorktreeIdForRepo } from '../../shared/workspace-instance-worktree'
import { mergeRuntimeFolderWorkspace } from './runtime-folder-workspace'
import type { RuntimeStore } from './runtime-store-contract'
import { getRuntimeFolderWorkspaceInstanceIdentity } from './runtime-worktree-filesystem'

/**
 * A git project's terminal groups: extra workspace instances on its main checkout. `git worktree
 * list` cannot describe them, so they are appended to every scan rather than filtered out of one.
 */
export function listRuntimeTerminalGroups(
  store: Pick<RuntimeStore, 'getAllWorktreeMeta' | 'setWorktreeMeta'>,
  repo: Repo,
  // Why: the resolution pass fans out over every repo, so it reads the meta map once and threads
  // the snapshot through instead of re-materializing it per repo.
  metaSnapshot?: Record<string, WorktreeMeta>
): Worktree[] {
  if (isFolderRepo(repo)) {
    return []
  }
  const allMeta = metaSnapshot ?? store.getAllWorktreeMeta()
  return Object.keys(allMeta)
    .filter((worktreeId) => isWorkspaceInstanceWorktreeIdForRepo(repo, worktreeId))
    .map((worktreeId) => {
      const existing = allMeta[worktreeId]
      const meta = existing?.instanceId
        ? existing
        : store.setWorktreeMeta(worktreeId, {
            instanceId: getRuntimeFolderWorkspaceInstanceIdentity(repo, worktreeId)
          })
      return mergeRuntimeFolderWorkspace(repo, worktreeId, meta)
    })
    .sort((left, right) => {
      return (right.createdAt ?? right.lastActivityAt) - (left.createdAt ?? left.lastActivityAt)
    })
}
