import { describe, expect, it } from 'vitest'

import {
  buildJiraIssueWorkspaceAttachmentIndex,
  findJiraIssueWorkspaceAttachment,
  findJiraIssueWorkspaceAttachmentInIndex,
  getJiraIssueWorkspaceAttachmentLabel
} from './jira-issue-workspace-attachment'
import type { WorkspaceLinkedItem, Worktree } from '../../../shared/worktree/types'

function jiraLink(overrides: Partial<WorkspaceLinkedItem> = {}): WorkspaceLinkedItem {
  return {
    provider: 'jira',
    type: 'issue',
    number: 0,
    title: 'WOLF-1 Fix the thing',
    url: 'https://perc-team.atlassian.net/browse/WOLF-1',
    jiraIdentifier: 'WOLF-1',
    ...overrides
  }
}

function worktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: overrides.id ?? 'wt-1',
    repoId: overrides.repoId ?? 'repo-1',
    path: overrides.path ?? '/tmp/repo-1/wt-1',
    head: 'abc123',
    branch: overrides.branch ?? 'refs/heads/feature/jira-attachment',
    isBare: false,
    isMainWorktree: false,
    displayName: overrides.displayName ?? 'Jira workspace',
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0,
    ...overrides
  }
}

describe('Jira issue workspace attachment', () => {
  it('finds the workspace whose linked work item matches the issue key', () => {
    const attached = worktree({ linkedWorkItem: jiraLink() })
    const unrelated = worktree({
      id: 'wt-2',
      linkedWorkItem: jiraLink({ jiraIdentifier: 'WOLF-2' })
    })

    expect(findJiraIssueWorkspaceAttachment([unrelated, attached], { key: 'WOLF-1' })).toBe(
      attached
    )
  })

  it('matches issue keys case-insensitively', () => {
    const attached = worktree({ linkedWorkItem: jiraLink({ jiraIdentifier: 'wolf-1' }) })

    expect(findJiraIssueWorkspaceAttachment([attached], { key: 'WOLF-1' })).toBe(attached)
  })

  it('ignores archived workspaces and non-Jira linked items', () => {
    const archived = worktree({ isArchived: true, linkedWorkItem: jiraLink() })
    const github = worktree({
      id: 'wt-2',
      linkedWorkItem: jiraLink({ provider: 'github', jiraIdentifier: undefined })
    })

    expect(findJiraIssueWorkspaceAttachment([archived, github], { key: 'WOLF-1' })).toBeNull()
  })

  it('refuses cross-site matches when both sides know their site URL', () => {
    const otherSite = worktree({
      linkedWorkItem: jiraLink({ url: 'https://other-team.atlassian.net/browse/WOLF-1' })
    })

    expect(
      findJiraIssueWorkspaceAttachment([otherSite], {
        key: 'WOLF-1',
        url: 'https://perc-team.atlassian.net/browse/WOLF-1'
      })
    ).toBeNull()
  })

  it('prefers the most recently active workspace among equal matches', () => {
    const older = worktree({ id: 'older', linkedWorkItem: jiraLink(), lastActivityAt: 10 })
    const newer = worktree({ id: 'newer', linkedWorkItem: jiraLink(), lastActivityAt: 20 })

    expect(findJiraIssueWorkspaceAttachment([older, newer], { key: 'WOLF-1' })).toBe(newer)
  })

  it('index lookups agree with the direct scan', () => {
    const attached = worktree({ linkedWorkItem: jiraLink() })
    const index = buildJiraIssueWorkspaceAttachmentIndex([attached])

    expect(findJiraIssueWorkspaceAttachmentInIndex(index, { key: 'wolf-1' })).toBe(attached)
    expect(findJiraIssueWorkspaceAttachmentInIndex(index, { key: 'WOLF-9' })).toBeNull()
  })

  it('labels the attachment from the workspace display name', () => {
    expect(getJiraIssueWorkspaceAttachmentLabel(worktree({ displayName: 'wolf fix' }))).toBe(
      'wolf fix'
    )
  })
})
