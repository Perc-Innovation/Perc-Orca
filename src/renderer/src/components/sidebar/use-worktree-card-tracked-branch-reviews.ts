import React, { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import {
  getHostedReviewCacheKey,
  withAcceptedMergedBranchReview
} from '@/store/slices/hosted-review'
import { isMacAppDataPath } from '@/lib/passive-macos-app-data-access'
import { isWebClient, type WorktreeCardProps } from './worktree-card-model'
import { getTrackedBranchReviewRows } from './worktree-card-tracked-branch-reviews'
import type { CardReviewRow } from './worktree-card-attached-reviews'
import type { useWorktreeCardFoundation } from './use-worktree-card-foundation'

type Foundation = ReturnType<typeof useWorktreeCardFoundation>

/**
 * Tracked sibling branches' reviews for the card, resolved lazily: they are
 * only visible inside the details hover, so their lookups run on open instead
 * of joining the always-on poll — N extra branches cost nothing until someone
 * actually looks. No `active` hint: the active-branch fast lane is a global
 * quota the worktree's own branch uses.
 */
export function useWorktreeCardTrackedBranchReviews({
  worktree,
  repo,
  settings,
  isFolder,
  branch,
  newCardStyle,
  showPR,
  hoverDetailsOpen,
  fetchHostedReviewForBranch
}: {
  worktree: WorktreeCardProps['worktree']
  repo: WorktreeCardProps['repo']
  settings: Foundation['settings']
  isFolder: boolean
  branch: string
  newCardStyle: boolean
  showPR: boolean
  hoverDetailsOpen: boolean
  fetchHostedReviewForBranch: Foundation['fetchHostedReviewForBranch']
}): CardReviewRow[] {
  // Why: mirror the primary review's visibility — always available to the new
  // style's hover, gated by the pr card property in the legacy style.
  const trackedBranchNames = React.useMemo(
    () =>
      newCardStyle || showPR
        ? (worktree.trackedBranches ?? []).filter((name) => name !== branch)
        : [],
    [newCardStyle, showPR, worktree.trackedBranches, branch]
  )
  const trackedBranchCacheKeys = React.useMemo(
    () =>
      repo && !isFolder
        ? trackedBranchNames.map((name) =>
            withAcceptedMergedBranchReview(
              getHostedReviewCacheKey(
                repo.path,
                name,
                settings,
                repo.id,
                repo.connectionId,
                repo.executionHostId,
                true
              )
            )
          )
        : [],
    [repo, isFolder, trackedBranchNames, settings]
  )
  const trackedBranchEntries = useAppStore(
    useShallow((s) => trackedBranchCacheKeys.map((key) => s.hostedReviewCache[key]?.data ?? null))
  )
  const trackedBranchReviewRows = React.useMemo(
    () => getTrackedBranchReviewRows(trackedBranchNames, branch, trackedBranchEntries),
    [trackedBranchNames, branch, trackedBranchEntries]
  )

  useEffect(() => {
    if (
      !hoverDetailsOpen ||
      isWebClient() ||
      !repo ||
      isFolder ||
      worktree.isBare ||
      trackedBranchNames.length === 0 ||
      isMacAppDataPath(repo.path)
    ) {
      return
    }
    for (const name of trackedBranchNames) {
      void fetchHostedReviewForBranch(repo.path, name, {
        repoId: repo.id,
        staleWhileRevalidate: true,
        // Why: nobody has this branch checked out here — its merged review is
        // the row's answer, not a reused-branch leftover to hide.
        acceptMergedBranchReview: true
      })
    }
  }, [
    hoverDetailsOpen,
    repo,
    isFolder,
    worktree.isBare,
    trackedBranchNames,
    fetchHostedReviewForBranch
  ])

  return trackedBranchReviewRows
}
