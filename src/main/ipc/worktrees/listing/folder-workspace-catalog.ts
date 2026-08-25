import { randomUUID } from 'node:crypto'
import { isFolderRepo } from '../../../../shared/repo-kind'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import type { WorktreeMeta } from '../../../../shared/worktree/meta-types'
import {
  getWorkspaceInstanceIdentity,
  isWorkspaceInstanceWorktreeIdForRepo
} from '../../../../shared/workspace-instance-worktree'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree, DetectedWorktree } from '../../../../shared/worktree/types'
import type { Store } from '../../../persistence/loading-store/store'
import {
  createWorktreeVisibilitySourceMatcher,
  resolveCustomWorktreeVisibilitySources
} from '../../../../shared/worktree/visibility-sources'
import { resolveConfiguredWorktreeBasePaths } from '../../../../shared/worktree/configured-worktree-base-path'
import {
  toDetectedWorktree,
  applyMetadataFallbackVisibility
} from '../../../../shared/worktree/ownership'
import { projectResolvedWorktreeLineage } from '../../../../shared/resolved-worktree-lineage'
import { getProjectHostSetupMetaUpdates } from './worktree-discovery-metadata'
import {
  getFolderWorkspaceInstanceIdentity,
  getFolderWorkspaceRootId,
  isFolderWorkspaceIdForRepo,
  mergeFolderWorkspace
} from '../folder-workspace-model'

export function listFolderWorkspaces(store: Store, repo: Repo): Worktree[] {
  const rootId = getFolderWorkspaceRootId(repo)
  const allMeta = store.getAllWorktreeMeta()
  const ids = Object.keys(allMeta).filter((worktreeId) =>
    isFolderWorkspaceIdForRepo(repo, worktreeId)
  )
  if (!ids.includes(rootId)) {
    ids.unshift(rootId)
  }

  return ids
    .map((worktreeId) => {
      const existing = allMeta[worktreeId]
      const ownershipUpdates = getProjectHostSetupMetaUpdates(store, repo, existing)
      const meta =
        existing?.instanceId && Object.keys(ownershipUpdates).length === 0
          ? existing
          : store.setWorktreeMeta(worktreeId, {
              instanceId:
                existing?.instanceId ?? getFolderWorkspaceInstanceIdentity(repo, worktreeId),
              ...ownershipUpdates,
              ...(existing ? {} : { displayName: repo.displayName, lastActivityAt: Date.now() })
            })
      return mergeFolderWorkspace(repo, worktreeId, meta)
    })
    .sort((a, b) => {
      if (a.id === rootId) {
        return -1
      }
      if (b.id === rootId) {
        return 1
      }
      return (b.createdAt ?? b.lastActivityAt) - (a.createdAt ?? a.lastActivityAt)
    })
}

export function buildFolderDetectedWorktrees(store: Store, repo: Repo): DetectedWorktree[] {
  const settings = store.getSettings()
  const worktrees = listFolderWorkspaces(store, repo)
  const worktreeVisibilitySourceMatcher = createWorktreeVisibilitySourceMatcher(
    [repo.path, ...worktrees.map((worktree) => worktree.path)],
    resolveCustomWorktreeVisibilitySources(repo, settings.worktreeVisibilityDefaults),
    resolveConfiguredWorktreeBasePaths(repo)
  )
  return worktrees.map((worktree) =>
    toDetectedWorktree({
      repo,
      worktree,
      meta: store.getWorktreeMeta(worktree.id),
      settings,
      knownOrcaLayouts: [],
      isLegacyRepoForVisibility: true,
      worktreeVisibilitySourceMatcher
    })
  )
}

export function listVisibleFolderWorkspaces(store: Store, repo: Repo): Worktree[] {
  return buildFolderDetectedWorktrees(store, repo)
    .filter((worktree) => worktree.visible)
    .map((worktree) => {
      const meta = store.getWorktreeMeta(worktree.id)
      const ownershipUpdates = getProjectHostSetupMetaUpdates(store, repo, meta)
      const repairedMeta =
        meta && Object.keys(ownershipUpdates).length === 0
          ? meta
          : store.setWorktreeMeta(worktree.id, ownershipUpdates)
      return mergeFolderWorkspace(repo, worktree.id, repairedMeta)
    })
}

export function buildDisconnectedDetectedWorktrees(
  store: Store,
  repo: Repo,
  worktrees: Worktree[]
): DetectedWorktree[] {
  const settings = store.getSettings()
  const worktreeVisibilitySourceMatcher = createWorktreeVisibilitySourceMatcher(
    [repo.path, ...worktrees.map((worktree) => worktree.path)],
    resolveCustomWorktreeVisibilitySources(repo, settings.worktreeVisibilityDefaults),
    resolveConfiguredWorktreeBasePaths(repo)
  )
  const detected = worktrees.map((worktree) => {
    const meta = store.getWorktreeMeta(worktree.id)
    const detected = toDetectedWorktree({
      repo,
      worktree,
      meta,
      settings,
      knownOrcaLayouts: [],
      isLegacyRepoForVisibility: true,
      worktreeVisibilitySourceMatcher
    })
    return applyMetadataFallbackVisibility(detected)
  })
  return projectResolvedWorktreeLineage(detected, store.getAllWorktreeLineage?.() ?? {})
}

/** Mints one for a legacy row that predates instance stamping. */
function getWorkspaceInstanceIdentityOrNew(repo: Repo, worktreeId: string): string {
  return getWorkspaceInstanceIdentity(repo, worktreeId) ?? randomUUID()
}

/**
 * Terminal groups: a git project's extra workspace instances on its main checkout. They never come
 * from `git worktree list`, so they are appended to the scan instead of filtered out of it — and
 * unlike a folder project, the root row here is a real worktree the scan already published.
 */
export function listTerminalGroupWorkspaces(
  store: Store,
  repo: Repo,
  // Why: `worktrees:listAll` fans out over every repo, so the multi-MB meta map is read once by the
  // caller and threaded through instead of re-materialized per repo.
  metaSnapshot?: Record<string, WorktreeMeta>
): Worktree[] {
  if (isFolderRepo(repo)) {
    return []
  }
  const expectedHostId = getRepoExecutionHostId(repo)
  const repoOwnerCount = store.getRepos().filter((candidate) => candidate.id === repo.id).length
  const allMeta = metaSnapshot ?? store.getAllWorktreeMeta()
  return Object.keys(allMeta)
    .filter((worktreeId) => {
      if (!isWorkspaceInstanceWorktreeIdForRepo(repo, worktreeId)) {
        return false
      }
      // Why: one repo id can be registered on several execution hosts; never republish another host's rows.
      const meta = allMeta[worktreeId]
      return meta?.hostId ? meta.hostId === expectedHostId : repoOwnerCount <= 1
    })
    .map((worktreeId) => {
      const existing = allMeta[worktreeId]
      const ownershipUpdates = getProjectHostSetupMetaUpdates(store, repo, existing)
      const meta =
        existing?.instanceId && Object.keys(ownershipUpdates).length === 0
          ? existing
          : store.setWorktreeMeta(worktreeId, {
              instanceId:
                existing?.instanceId ?? getWorkspaceInstanceIdentityOrNew(repo, worktreeId),
              ...ownershipUpdates
            })
      return mergeFolderWorkspace(repo, worktreeId, meta)
    })
    .sort((a, b) => (b.createdAt ?? b.lastActivityAt) - (a.createdAt ?? a.lastActivityAt))
}

/**
 * Terminal groups must ride along on the detected listing too: an authoritative refresh purges every
 * known worktree id it does not report, which would reap their tabs and sessions.
 */
export function buildTerminalGroupDetectedWorktrees(store: Store, repo: Repo): DetectedWorktree[] {
  const settings = store.getSettings()
  return listTerminalGroupWorkspaces(store, repo).map((worktree) =>
    toDetectedWorktree({
      repo,
      worktree,
      meta: store.getWorktreeMeta(worktree.id),
      settings,
      knownOrcaLayouts: [],
      isLegacyRepoForVisibility: true
    })
  )
}
