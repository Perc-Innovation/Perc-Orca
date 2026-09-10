import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { getWorktreeVisitTimestamp } from '@/lib/worktree-visit-recency'
import { getProjectGroupSubtreeIds } from '../../../../shared/project-groups'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import { resolveWorkspaceProjectGroupId } from '../../../../shared/workspace-project-group'
import { splitWorktreeId } from '../../../../shared/worktree/id'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import type { WorkspaceOption } from './workspace-selection'

/**
 * Switching workspace changes what the window shows, not only what the sidebar lists. The
 * content area follows: the workspace the user was last in inside the chosen one comes back with
 * its tabs, and a workspace never opened lands on the welcome screen instead of staying on a
 * terminal from the workspace just left.
 *
 * Mirrors `main/window/project-window-session-focus.ts`, which does the same for a project
 * window opening: most recently visited, with something to show, ties broken by key.
 */

export type WorkspaceSwitchFocus = { key: string; hostId?: ExecutionHostId }

type WorkspaceSwitchFocusState = Pick<
  AppState,
  | 'repos'
  | 'projectGroups'
  | 'folderWorkspaces'
  | 'tabsByWorktree'
  | 'unifiedTabsByWorktree'
  | 'lastVisitedAtByWorktreeId'
  | 'getKnownWorktreeById'
>

export function pickWorkspaceFocusOnSwitch(
  option: WorkspaceOption,
  state: WorkspaceSwitchFocusState
): WorkspaceSwitchFocus | null {
  const repoById = new Map(state.repos.map((repo) => [repo.id, repo]))
  const sources = {
    getRepo: (repoId: string) => repoById.get(repoId),
    getFolderWorkspaces: () => state.folderWorkspaces
  }
  const groupIds =
    option.kind === 'group' ? getProjectGroupSubtreeIds(state.projectGroups, option.id) : null
  const ungroupedRepoIds = option.kind === 'ungrouped' ? new Set(option.repoIds) : null
  const belongs = (key: string): boolean => {
    if (groupIds) {
      const groupId = resolveWorkspaceProjectGroupId(sources, key)
      return groupId !== null && groupIds.has(groupId)
    }
    // Why no folder keys here: a folder workspace always carries a group, so none is ungrouped.
    if (parseWorkspaceKey(key)?.type === 'folder') {
      return false
    }
    const repoId = splitWorktreeId(key)?.repoId
    return repoId !== undefined && ungroupedRepoIds!.has(repoId)
  }

  let best: WorkspaceSwitchFocus | null = null
  let bestVisitedAt = -Infinity
  for (const key of workspaceKeysWithSomethingOpen(state)) {
    if (!belongs(key)) {
      continue
    }
    // Why: a key can outlive its workspace (removed repo, host gone); nothing to activate then.
    const known = state.getKnownWorktreeById(key)
    if (!known) {
      continue
    }
    const visitedAt = getWorktreeVisitTimestamp(state.lastVisitedAtByWorktreeId, known) ?? 0
    if (visitedAt > bestVisitedAt || (visitedAt === bestVisitedAt && best && key < best.key)) {
      best = { key, ...(known.hostId ? { hostId: known.hostId } : {}) }
      bestVisitedAt = visitedAt
    }
  }
  return best
}

/** Terminals or editor/browser tabs alike: either is something the user would call open. */
function workspaceKeysWithSomethingOpen(state: WorkspaceSwitchFocusState): Set<string> {
  const keys = new Set<string>()
  for (const [key, tabs] of Object.entries(state.tabsByWorktree)) {
    if (tabs.length > 0) {
      keys.add(key)
    }
  }
  for (const [key, tabs] of Object.entries(state.unifiedTabsByWorktree)) {
    if (tabs.length > 0) {
      keys.add(key)
    }
  }
  return keys
}

/** Applies the pick to the live store: activate what was open there, or clear to the welcome. */
export function focusWorkspaceOnSwitch(option: WorkspaceOption): void {
  const state = useAppStore.getState()
  const focus = pickWorkspaceFocusOnSwitch(option, state)
  if (!focus) {
    state.setActiveWorktree(null)
    return
  }
  // Why not clear filters: the switch just set them, and the target is inside the new workspace.
  activateAndRevealWorktree(focus.key, {
    clearSidebarFilters: false,
    ...(focus.hostId ? { executionHostId: focus.hostId } : {})
  })
}
