import {
  isAutomationGeneratedWorkspace,
  isCliCreatedWorkspace,
  isDetachedHeadWorkspace,
  isSleepingSweepExemptWorkspace
} from '@/components/sidebar/visible-worktrees'
import { isDefaultBranchWorkspace } from '@/components/sidebar/default-branch-workspace'
import { isInactiveWorkspace } from '@/lib/worktree-activity-state'
import { isWorkspaceFromOtherDevice } from '@/components/sidebar/workspace-creator-visibility'
import type { Worktree } from '../../../shared/worktree/types'
import type { WorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import type { WorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'

type EmptyQueryVisibilityInput = Pick<
  WorktreeJumpPaletteStoreState,
  | 'hideDefaultBranchWorkspace'
  | 'hideAutomationGeneratedWorkspaces'
  | 'hideCliCreatedWorkspaces'
  | 'hideDetachedHeadWorkspaces'
  | 'hideWorkspacesFromOtherDevices'
  | 'showSleepingWorkspaces'
  | 'alwaysShowDefaultBranchWorkspace'
  | 'tabsByWorktree'
  | 'ptyIdsByTabId'
  | 'browserTabsByWorktree'
> &
  Pick<WorktreeJumpPaletteFilter, 'filterPredicate'> & {
    pairedDeviceIdsByEnvironment: Parameters<typeof isWorkspaceFromOtherDevice>[1]
    worktreeIdsWithLiveAgent: ReadonlySet<string>
  }

/** The sidebar's visibility rules, applied to the Cmd+J empty-query list. */
export function filterEmptyQueryVisibleWorktrees(
  allWorktrees: readonly Worktree[],
  input: EmptyQueryVisibilityInput
): Worktree[] {
  return allWorktrees.filter((worktree) => {
    if (worktree.isArchived) {
      return false
    }
    if (input.filterPredicate && !input.filterPredicate.matchesWorktree(worktree)) {
      return false
    }
    if (input.hideDefaultBranchWorkspace && isDefaultBranchWorkspace(worktree)) {
      return false
    }
    if (input.hideAutomationGeneratedWorkspaces && isAutomationGeneratedWorkspace(worktree)) {
      return false
    }
    if (input.hideCliCreatedWorkspaces && isCliCreatedWorkspace(worktree)) {
      return false
    }
    if (input.hideDetachedHeadWorkspaces && isDetachedHeadWorkspace(worktree)) {
      return false
    }
    if (
      input.hideWorkspacesFromOtherDevices &&
      isWorkspaceFromOtherDevice(worktree, input.pairedDeviceIdsByEnvironment)
    ) {
      return false
    }
    if (
      !input.showSleepingWorkspaces &&
      !isSleepingSweepExemptWorkspace(worktree, input.alwaysShowDefaultBranchWorkspace) &&
      isInactiveWorkspace(
        worktree.id,
        input.tabsByWorktree,
        input.ptyIdsByTabId,
        input.browserTabsByWorktree,
        input.worktreeIdsWithLiveAgent
      )
    ) {
      return false
    }
    return true
  })
}
