import type { JiraIssue } from '../../../shared/jira-types'
import type { WorkspaceLinkedItem, Worktree } from '../../../shared/worktree/types'
import { getWorktreeAttachmentLabel } from './worktree-attachment-label'

export type JiraIssueAttachmentRef = Pick<JiraIssue, 'key'> & Partial<Pick<JiraIssue, 'url'>>

/** Normalized issue key -> linking worktrees, in worktree order. */
export type JiraIssueWorkspaceAttachmentIndex = ReadonlyMap<string, readonly Worktree[]>

export function normalizeJiraIssueKey(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed.toUpperCase() : null
}

function getWorktreeJiraLink(worktree: Worktree): WorkspaceLinkedItem | null {
  const item = worktree.linkedWorkItem
  return item && item.provider === 'jira' ? item : null
}

function urlOrigin(url: string | null | undefined): string | null {
  if (!url) {
    return null
  }
  try {
    return new URL(url).origin.toLowerCase()
  } catch {
    return null
  }
}

function findScopedAttachment(
  candidates: readonly Worktree[],
  issue: JiraIssueAttachmentRef
): Worktree | null {
  const issueOrigin = urlOrigin(issue.url)
  let best: Worktree | null = null
  let bestScore = -1
  for (const worktree of candidates) {
    const worktreeOrigin = urlOrigin(getWorktreeJiraLink(worktree)?.url)
    // Why: the same issue key can exist on two connected Jira sites; refuse
    // cross-site matches when both sides know their site URL.
    if (issueOrigin && worktreeOrigin && issueOrigin !== worktreeOrigin) {
      continue
    }
    const score = Number(Boolean(issueOrigin && worktreeOrigin))
    if (
      score > bestScore ||
      (score === bestScore && best !== null && worktree.lastActivityAt > best.lastActivityAt)
    ) {
      best = worktree
      bestScore = score
    }
  }
  return best
}

export function findJiraIssueWorkspaceAttachment(
  worktrees: readonly Worktree[],
  issue: JiraIssueAttachmentRef
): Worktree | null {
  const key = normalizeJiraIssueKey(issue.key)
  if (!key) {
    return null
  }
  return findScopedAttachment(
    worktrees.filter(
      (worktree) =>
        !worktree.isArchived &&
        normalizeJiraIssueKey(getWorktreeJiraLink(worktree)?.jiraIdentifier) === key
    ),
    issue
  )
}

/** Why: issue rows would otherwise rescan every worktree per row; one pass per
 *  worktree list turns each row lookup into a map hit. */
export function buildJiraIssueWorkspaceAttachmentIndex(
  worktrees: readonly Worktree[]
): JiraIssueWorkspaceAttachmentIndex {
  const index = new Map<string, Worktree[]>()
  for (const worktree of worktrees) {
    if (worktree.isArchived) {
      continue
    }
    const key = normalizeJiraIssueKey(getWorktreeJiraLink(worktree)?.jiraIdentifier)
    if (!key) {
      continue
    }
    const bucket = index.get(key)
    if (bucket) {
      bucket.push(worktree)
    } else {
      index.set(key, [worktree])
    }
  }
  return index
}

export function findJiraIssueWorkspaceAttachmentInIndex(
  index: JiraIssueWorkspaceAttachmentIndex,
  issue: JiraIssueAttachmentRef
): Worktree | null {
  const key = normalizeJiraIssueKey(issue.key)
  if (!key) {
    return null
  }
  const candidates = index.get(key)
  return candidates ? findScopedAttachment(candidates, issue) : null
}

export function getJiraIssueWorkspaceAttachmentLabel(worktree: Worktree): string {
  return getWorktreeAttachmentLabel(worktree)
}
