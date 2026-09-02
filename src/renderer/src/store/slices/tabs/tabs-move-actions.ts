import type { TabsSlice, TabsSliceGet, TabsSliceSet } from './tabs-slice-contract'
import { collapseGroupLayout } from './tabs-layout'
import { buildActiveSurfacePatch, buildBackgroundSurfacePatch } from './tabs-surface'
import { buildTabWorkspaceMove, type TabWorkspaceMove } from '../tab-workspace-move'
import {
  dedupeTabOrder,
  findGroupAndWorktree,
  findGroupForTab,
  findTabAndWorktree,
  pickNextActiveTab,
  pushRecentTabId,
  sanitizeRecentTabIds
} from '../tab-group-state'

export function createTabsMoveActions(
  set: TabsSliceSet,
  get: TabsSliceGet
): Pick<TabsSlice, 'moveUnifiedTabToGroup' | 'moveUnifiedTabToWorkspace'> {
  return {
    moveUnifiedTabToWorkspace: (tabId, targetWorktreeId) => {
      let move: TabWorkspaceMove | null = null
      set((state) => {
        const built = buildTabWorkspaceMove(state, tabId, targetWorktreeId)
        if (!built) {
          return {}
        }
        move = built
        // Why: both workspaces changed membership, so each needs its remembered
        // surface re-derived; only the visible one may rewrite the global fields.
        const next = { ...state, ...built.patch }
        const surfaces = [built.sourceWorktreeId, built.targetWorktreeId]
        const background = surfaces.filter((worktreeId) => worktreeId !== state.activeWorktreeId)
        let patched = { ...built.patch, ...buildBackgroundSurfacePatch(next, background) }
        if (surfaces.includes(state.activeWorktreeId ?? '')) {
          const activeWorktreeId = state.activeWorktreeId as string
          patched = {
            ...patched,
            ...buildActiveSurfacePatch(
              { ...next, ...patched },
              activeWorktreeId,
              (patched.activeGroupIdByWorktree ?? next.activeGroupIdByWorktree)[activeWorktreeId] ??
                null
            )
          }
        }
        return patched
      })
      if (move) {
        get().recordFeatureInteraction?.('terminal-tabs')
      }
      return move
    },
    moveUnifiedTabToGroup: (tabId, targetGroupId, opts) => {
      let moved = false
      set((state) => {
        const foundTab = findTabAndWorktree(state.unifiedTabsByWorktree, tabId)
        const foundTarget = findGroupAndWorktree(state.groupsByWorktree, targetGroupId)
        if (!foundTab || !foundTarget || foundTab.worktreeId !== foundTarget.worktreeId) {
          return {}
        }
        const { tab, worktreeId } = foundTab
        if (tab.groupId === targetGroupId) {
          return {}
        }
        const sourceGroup = findGroupForTab(state.groupsByWorktree, worktreeId, tab.groupId)
        const targetGroup = foundTarget.group
        if (!sourceGroup) {
          return {}
        }
        moved = true

        const dedupedSourceGroupOrder = dedupeTabOrder(sourceGroup.tabOrder)
        const sourceOrder = dedupeTabOrder(dedupedSourceGroupOrder.filter((id) => id !== tabId))
        // Why: defensive dedupe so target order can't grow a duplicate id (stale state); see dropUnifiedTab for the same guard.
        const targetOrder = dedupeTabOrder(targetGroup.tabOrder.filter((id) => id !== tabId))
        const targetIndex = Math.max(
          0,
          Math.min(opts?.index ?? targetOrder.length, targetOrder.length)
        )
        targetOrder.splice(targetIndex, 0, tabId)
        const nextActiveGroupIdByWorktree = {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: opts?.activate ? targetGroupId : state.activeGroupIdByWorktree[worktreeId]
        }
        const sourceRecentTabIds = sanitizeRecentTabIds(
          (sourceGroup.recentTabIds ?? []).filter((id) => id !== tabId),
          sourceOrder
        )
        const nextGroups = (state.groupsByWorktree[worktreeId] ?? []).map((group) => {
          if (group.id === sourceGroup.id) {
            return {
              ...group,
              activeTabId:
                group.activeTabId === tabId
                  ? // Why: keep MRU-aware selection so the user lands on their previously-focused tab, not a visual neighbor.
                    pickNextActiveTab(dedupedSourceGroupOrder, sourceGroup.recentTabIds, tabId)
                  : group.activeTabId,
              tabOrder: sourceOrder,
              recentTabIds: sourceRecentTabIds
            }
          }
          if (group.id === targetGroupId) {
            const sanitizedTargetRecent = sanitizeRecentTabIds(group.recentTabIds, targetOrder)
            return {
              ...group,
              activeTabId: opts?.activate ? tabId : group.activeTabId,
              tabOrder: targetOrder,
              recentTabIds: opts?.activate
                ? pushRecentTabId(sanitizedTargetRecent, tabId)
                : sanitizedTargetRecent
            }
          }
          return group
        })
        let nextLayoutByWorktree = state.layoutByWorktree
        let nextActiveGroupIdByWorktreeResolved = nextActiveGroupIdByWorktree
        let filteredGroups = nextGroups
        if (sourceOrder.length === 0) {
          filteredGroups = nextGroups.filter((group) => group.id !== sourceGroup.id)
          const collapsedState = collapseGroupLayout(
            nextLayoutByWorktree,
            nextActiveGroupIdByWorktreeResolved,
            worktreeId,
            sourceGroup.id,
            targetGroupId
          )
          nextLayoutByWorktree = collapsedState.layoutByWorktree
          nextActiveGroupIdByWorktreeResolved = collapsedState.activeGroupIdByWorktree
        }
        const nextGroupsByWorktree = {
          ...state.groupsByWorktree,
          [worktreeId]: filteredGroups
        }
        const nextUnifiedTabsByWorktree = {
          ...state.unifiedTabsByWorktree,
          [worktreeId]: (state.unifiedTabsByWorktree[worktreeId] ?? []).map((candidate) =>
            candidate.id === tabId ? { ...candidate, groupId: targetGroupId } : candidate
          )
        }
        return {
          unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
          groupsByWorktree: nextGroupsByWorktree,
          layoutByWorktree: nextLayoutByWorktree,
          activeGroupIdByWorktree: nextActiveGroupIdByWorktreeResolved,
          ...(state.activeWorktreeId === worktreeId
            ? buildActiveSurfacePatch(
                {
                  ...state,
                  unifiedTabsByWorktree: nextUnifiedTabsByWorktree,
                  groupsByWorktree: nextGroupsByWorktree,
                  layoutByWorktree: nextLayoutByWorktree,
                  activeGroupIdByWorktree: nextActiveGroupIdByWorktreeResolved
                },
                worktreeId,
                nextActiveGroupIdByWorktreeResolved[worktreeId] ?? null
              )
            : {})
        }
      })
      if (moved && opts?.recordInteraction !== false) {
        get().recordFeatureInteraction?.('tab-splits')
      }
      return moved
    }
  }
}
