import type { Repo } from '../../shared/repo-types'
import type { NativeLocalWorktreeMetadataScanExpectation } from '../persistence/tracking-repos/missing-local-worktree-metadata-pruning'
import { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import type { Store } from '../persistence'
import type { RuntimeStore } from './runtime-store-contract'

/**
 * The destructive scan expectation for one repo, or undefined when this repo must not carry one.
 *
 * WSL-routed repos are excluded for the same reason the desktop listing excludes them: the listing
 * runs in the distro and reports Linux paths while metadata can hold UNC ones, and v1 cannot prove
 * those aliases equivalent. A runtime that needs repair throws rather than resolving routing, which
 * is likewise no basis for deleting rows.
 */
export function captureLocalMetadataPruneExpectation(
  store: RuntimeStore,
  repo: Repo
): NativeLocalWorktreeMetadataScanExpectation | undefined {
  if (typeof store.captureNativeLocalWorktreeMetadataScanExpectation !== 'function') {
    return undefined
  }
  try {
    if (getLocalProjectWorktreeGitOptions(store as unknown as Store, repo).wslDistro) {
      return undefined
    }
  } catch {
    return undefined
  }
  return store.captureNativeLocalWorktreeMetadataScanExpectation(repo)
}
