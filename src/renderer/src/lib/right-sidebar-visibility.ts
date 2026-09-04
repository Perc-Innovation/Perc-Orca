import type { AppState } from '@/store/types'
import { sharesProjectCheckout } from '../../../shared/workspace-instance-worktree'
import { getIndexedRepoMap, getIndexedWorktreeMap } from '@/store/worktree-repo-index'

type ActiveView = AppState['activeView']

const RIGHT_SIDEBAR_SUPPRESSED_VIEWS = new Set<ActiveView>([
  'settings',
  'tasks',
  'activity',
  'automations',
  'space',
  'skills',
  'artifacts',
  'mobile'
])

export function canShowRightSidebarForView(activeView: ActiveView): boolean {
  return !RIGHT_SIDEBAR_SUPPRESSED_VIEWS.has(activeView)
}

export function rightSidebarShowsPullRequestData(
  state: Pick<
    AppState,
    | 'activeView'
    | 'activeWorktreeId'
    | 'repos'
    | 'rightSidebarOpen'
    | 'rightSidebarTab'
    | 'worktreesByRepo'
  >
): boolean {
  if (
    !canShowRightSidebarForView(state.activeView) ||
    !state.rightSidebarOpen ||
    (state.rightSidebarTab !== 'checks' && state.rightSidebarTab !== 'source-control')
  ) {
    return false
  }

  const activeWorktree = state.activeWorktreeId
    ? getIndexedWorktreeMap(state.worktreesByRepo).get(state.activeWorktreeId)
    : undefined
  const activeRepo = activeWorktree
    ? getIndexedRepoMap(state.repos).get(activeWorktree.repoId)
    : null
  if (!activeRepo || sharesProjectCheckout(activeRepo, state.activeWorktreeId)) {
    return false
  }

  return true
}
