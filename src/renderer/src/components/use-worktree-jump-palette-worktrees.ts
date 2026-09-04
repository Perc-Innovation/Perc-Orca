import { useMemo } from 'react'
import { sortWorktreesSmart } from '@/components/sidebar/smart-sort'
import { buildWorktreeChecksReviewIndex } from '@/components/cmd-j/worktree-checks-review-index'
import { getLiveAgentStatusByWorktreeId } from '@/lib/worktree-activity-state'
import { orderEmptyQueryWorktrees } from '@/lib/order-empty-query-worktrees'
import {
  getWorktreePaletteSearchScope,
  searchWorktreeDocuments
} from '@/lib/worktree-palette-search'
import { buildPaletteWorktreeIndex, resolvePaletteWorktree } from '@/lib/palette-repo-resolution'
import {
  collectPaletteTabIndexWorkspaces,
  excludePaletteFolderWorkspaces
} from '@/components/cmd-j/palette-folder-workspace-tab-index'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  getPairedDeviceIdsByEnvironment
} from '@/components/sidebar/workspace-creator-visibility'
import type { Worktree } from '../../../shared/worktree/types'
import { EMPTY_SORTED_WORKTREES } from './worktree-jump-palette-model'
import type { WorktreeJumpPaletteFilter } from './use-worktree-jump-palette-filter'
import type { WorktreeJumpPaletteLocalState } from './use-worktree-jump-palette-local-state'
import type { WorktreeJumpPaletteStoreState } from './use-worktree-jump-palette-store-state'
import { buildWorktreeJumpPaletteDocumentIndex } from './worktree-jump-palette-document-index'
import { buildWorktreeJumpPaletteWorktreeMaps } from './worktree-jump-palette-worktree-maps'
import { filterEmptyQueryVisibleWorktrees } from './worktree-jump-palette-empty-query-visibility'

type WorktreeJumpPaletteWorktreesInput = WorktreeJumpPaletteStoreState &
  Pick<
    WorktreeJumpPaletteFilter,
    'filterPredicate' | 'repoMap' | 'repoByHostIdentity' | 'hostOptions' | 'hostFilterActive'
  > &
  Pick<WorktreeJumpPaletteLocalState, 'paletteSearchQuery'>

export function useWorktreeJumpPaletteWorktrees({
  paletteSearchQuery,
  repos,
  worktreesByRepo,
  agentStatusByPaneKey,
  tabsByWorktree,
  allWorktrees,
  folderWorkspaces,
  filterPredicate,
  hideDefaultBranchWorkspace,
  hideAutomationGeneratedWorkspaces,
  hideCliCreatedWorkspaces,
  hideDetachedHeadWorkspaces,
  hideWorkspacesFromOtherDevices,
  showSleepingWorkspaces,
  alwaysShowDefaultBranchWorkspace,
  ptyIdsByTabId,
  browserTabsByWorktree,
  activeWorktreeId,
  activeWorkspaceExecutionHostId,
  runtimeEnvironments,
  runtimeStatusByEnvironmentId,
  lastVisitedAtByWorktreeId,
  paletteStatusInputsActive,
  repoMap,
  runtimePaneTitlesByTabId,
  migrationUnsupportedByPtyId,
  terminalLayoutsByTabId,
  repoByHostIdentity,
  hostOptions,
  hostFilterActive,
  prCache,
  hostedReviewCache,
  settings,
  issueCache,
  workspacePortScan
}: WorktreeJumpPaletteWorktreesInput) {
  const hasQuery = paletteSearchQuery.length > 0
  const isLoading = repos.length > 0 && Object.keys(worktreesByRepo).length === 0
  const worktreeIdsWithLiveAgent = useMemo(
    () =>
      new Set(
        // The palette recomputes this snapshot when status inputs change; the
        // clock intentionally reflects the render that performs that snapshot.
        // oxlint-disable-next-line react/purity
        getLiveAgentStatusByWorktreeId(agentStatusByPaneKey, tabsByWorktree, Date.now()).keys()
      ),
    [agentStatusByPaneKey, tabsByWorktree]
  )
  const pairedDeviceIdsByEnvironment = useMemo(
    () =>
      hideWorkspacesFromOtherDevices
        ? getPairedDeviceIdsByEnvironment(runtimeEnvironments, runtimeStatusByEnvironmentId)
        : EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
    [hideWorkspacesFromOtherDevices, runtimeEnvironments, runtimeStatusByEnvironmentId]
  )
  const emptyQueryVisibleWorktrees = useMemo(
    () =>
      filterEmptyQueryVisibleWorktrees(allWorktrees, {
        filterPredicate,
        hideDefaultBranchWorkspace,
        hideAutomationGeneratedWorkspaces,
        hideCliCreatedWorkspaces,
        hideDetachedHeadWorkspaces,
        hideWorkspacesFromOtherDevices,
        showSleepingWorkspaces,
        alwaysShowDefaultBranchWorkspace,
        tabsByWorktree,
        ptyIdsByTabId,
        browserTabsByWorktree,
        pairedDeviceIdsByEnvironment,
        worktreeIdsWithLiveAgent
      }),
    [
      allWorktrees,
      alwaysShowDefaultBranchWorkspace,
      browserTabsByWorktree,
      filterPredicate,
      hideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces,
      hideDefaultBranchWorkspace,
      hideDetachedHeadWorkspaces,
      hideWorkspacesFromOtherDevices,
      pairedDeviceIdsByEnvironment,
      ptyIdsByTabId,
      showSleepingWorkspaces,
      tabsByWorktree,
      worktreeIdsWithLiveAgent
    ]
  )
  const { visibleWorktreesForState, switchableWorktreesForRows } = useMemo(
    () =>
      orderEmptyQueryWorktrees({
        visibleWorktrees: emptyQueryVisibleWorktrees,
        activeWorktreeId,
        activeWorkspaceExecutionHostId,
        lastVisitedAtByWorktreeId
      }),
    [
      emptyQueryVisibleWorktrees,
      activeWorktreeId,
      activeWorkspaceExecutionHostId,
      lastVisitedAtByWorktreeId
    ]
  )
  const searchScopeWorktrees = useMemo(() => {
    const scope = getWorktreePaletteSearchScope({
      hasQuery,
      allWorktrees,
      emptyQueryWorktrees: switchableWorktreesForRows
    })
    return hasQuery && filterPredicate ? scope.filter(filterPredicate.matchesWorktree) : scope
  }, [allWorktrees, filterPredicate, hasQuery, switchableWorktreesForRows])
  // Why unfiltered and ungated: tab ownership is decided against every workspace that
  // exists, not the subset the current filter renders.
  const paletteTabIndexOwnershipWorkspaces = useMemo(
    () => collectPaletteTabIndexWorkspaces(allWorktrees, folderWorkspaces),
    [allWorktrees, folderWorkspaces]
  )
  // Why: tab search is cross-workspace, so sort every workspace once (including archived
  // ones, and folder workspaces alongside worktrees so both kinds interleave by attention).
  const paletteTabIndexWorkspaces = useMemo(() => {
    if (!paletteStatusInputsActive) {
      return EMPTY_SORTED_WORKTREES
    }
    const scope = filterPredicate
      ? paletteTabIndexOwnershipWorkspaces.filter(filterPredicate.matchesWorktree)
      : paletteTabIndexOwnershipWorkspaces
    return sortWorktreesSmart(
      scope,
      tabsByWorktree,
      repoMap,
      agentStatusByPaneKey,
      runtimePaneTitlesByTabId,
      ptyIdsByTabId,
      migrationUnsupportedByPtyId,
      terminalLayoutsByTabId
    )
  }, [
    paletteStatusInputsActive,
    paletteTabIndexOwnershipWorkspaces,
    filterPredicate,
    tabsByWorktree,
    repoMap,
    agentStatusByPaneKey,
    runtimePaneTitlesByTabId,
    ptyIdsByTabId,
    migrationUnsupportedByPtyId,
    terminalLayoutsByTabId
  ])
  // Why derived, not a second sort: worktree rows, browser pages and simulator tabs have no
  // folder-workspace path yet, so they read the worktree-only view of the same ordering.
  const browserSortedWorktrees = useMemo(
    () => excludePaletteFolderWorkspaces(paletteTabIndexWorkspaces),
    [paletteTabIndexWorkspaces]
  )
  const sortedWorktrees = useMemo(
    () =>
      hasQuery
        ? browserSortedWorktrees.filter((worktree) => !worktree.isArchived)
        : searchScopeWorktrees,
    [hasQuery, browserSortedWorktrees, searchScopeWorktrees]
  )
  // Folder workspaces ride along so an open-tab row can resolve the workspace it belongs to.
  const paletteWorktreeIndex = useMemo(
    () => buildPaletteWorktreeIndex(paletteTabIndexWorkspaces),
    [paletteTabIndexWorkspaces]
  )
  const resolveWorktree = useMemo(
    () =>
      (worktreeId: string, hostId: Worktree['hostId'] | undefined): Worktree | undefined =>
        resolvePaletteWorktree(paletteWorktreeIndex, worktreeId, hostId),
    [paletteWorktreeIndex]
  )
  const { worktreeMap, worktreeOrder } = useMemo(
    () => buildWorktreeJumpPaletteWorktreeMaps(paletteTabIndexWorkspaces),
    [paletteTabIndexWorkspaces]
  )
  const checksReviewByWorktree = useMemo(
    () =>
      buildWorktreeChecksReviewIndex({
        worktrees: allWorktrees,
        repoByHostIdentity,
        prCache,
        hostedReviewCache,
        settings
      }),
    [allWorktrees, hostedReviewCache, prCache, repoByHostIdentity, settings]
  )
  const worktreeDocuments = useMemo(
    () =>
      buildWorktreeJumpPaletteDocumentIndex({
        worktrees: allWorktrees,
        repoMap,
        repoByHostIdentity,
        hostOptions,
        hostFilterActive,
        prCache,
        issueCache,
        workspacePortScan,
        checksReviewByWorktree
      }),
    [
      allWorktrees,
      checksReviewByWorktree,
      hostFilterActive,
      hostOptions,
      issueCache,
      prCache,
      repoByHostIdentity,
      repoMap,
      workspacePortScan
    ]
  )
  const worktreeMatches = useMemo(
    () =>
      searchWorktreeDocuments({
        worktrees: sortedWorktrees,
        query: paletteSearchQuery,
        documents: worktreeDocuments,
        repoMap,
        repoMapByHostIdentity: repoByHostIdentity,
        checksReviewByWorktree
      }),
    [
      checksReviewByWorktree,
      paletteSearchQuery,
      repoByHostIdentity,
      repoMap,
      sortedWorktrees,
      worktreeDocuments
    ]
  )
  return {
    hasQuery,
    isLoading,
    visibleWorktreesForState,
    switchableWorktreesForRows,
    searchScopeWorktrees,
    browserSortedWorktrees,
    paletteTabIndexWorkspaces,
    paletteTabIndexOwnershipWorkspaces,
    worktreeMap,
    resolveWorktree,
    paletteWorktreeIndex,
    worktreeOrder,
    worktreeMatches
  }
}

export type WorktreeJumpPaletteWorktrees = ReturnType<typeof useWorktreeJumpPaletteWorktrees>
