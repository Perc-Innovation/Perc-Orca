import {
  PTY_SESSION_ID_SEPARATOR,
  parsePtySessionId
} from '../../../../shared/pty-session-id-format'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'
import {
  getRepoIdFromWorktreeId,
  getWorktreePathBasenameFromId
} from '../../../../shared/worktree/id'
import type { MergeContext } from './resource-usage-merge-types'

/** How the Resource Manager names a workspace it only knows by id. */

export function deriveRepoIdFromWorktreeId(worktreeId: string): string {
  return getRepoIdFromWorktreeId(worktreeId)
}

export function deriveWorktreeNameFromWorktreeId(worktreeId: string): string {
  return getWorktreePathBasenameFromId(worktreeId) ?? worktreeId
}

/**
 * The workspace a daemon-only session belongs to. A folder workspace PTY id is
 * `folder:<id>@@<nonce>`: no `repo::path` for `parsePtySessionId` to find, so without the second
 * parse an orphan from a folder workspace lands in the unattributed bucket.
 */
export function resolveDaemonSessionWorktreeId(sessionId: string): string | null {
  const parsed = parsePtySessionId(sessionId).worktreeId
  if (parsed) {
    return parsed
  }
  const idx = sessionId.lastIndexOf(PTY_SESSION_ID_SEPARATOR)
  const candidate = idx > 0 ? sessionId.slice(0, idx) : null
  return candidate && parseWorkspaceKey(candidate)?.type === 'folder' ? candidate : null
}

/** A folder workspace is its own bucket and its own row; both carry the workspace's name. */
export function folderWorkspaceName(ctx: MergeContext, worktreeId: string): string | undefined {
  return ctx.folderWorkspaceNameByKey?.get(worktreeId)
}
