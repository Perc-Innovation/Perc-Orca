import { isWorkItemLinkQueryTooLarge } from '../../../../shared/new-workspace/work-item-link-query-bounds'
import { parseIssueLinkInput, type IssueLinkProvider } from '../../../../shared/issue-link-input'
import {
  parseGitLabMergeRequestNumberForMetaField,
  parseGitHubWorkItemNumberForMetaField,
  type WorktreeReviewProvider
} from './worktree-meta-updates'

// Why: both fields accept pasted URLs with no length cap and re-parse on every keystroke, so the
// size bound runs before the parser.
export function isWorktreeMetaIssueInputInvalid(
  issueInput: string,
  issueProvider: IssueLinkProvider,
  isFolderWorkspace: boolean
): boolean {
  const trimmed = issueInput.trim()
  if (trimmed === '' || isFolderWorkspace) {
    return false
  }
  return (
    isWorkItemLinkQueryTooLarge(trimmed) || parseIssueLinkInput(trimmed, issueProvider) === null
  )
}

export function isWorktreeMetaReviewInputValid(
  reviewInput: string,
  reviewProvider: WorktreeReviewProvider
): boolean {
  const trimmedPR = reviewInput.trim()
  return (
    trimmedPR === '' ||
    (!isWorkItemLinkQueryTooLarge(trimmedPR) &&
      (reviewProvider === 'gitlab'
        ? parseGitLabMergeRequestNumberForMetaField(trimmedPR)
        : parseGitHubWorkItemNumberForMetaField(trimmedPR, 'pr')) !== null)
  )
}
