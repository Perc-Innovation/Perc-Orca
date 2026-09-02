import { describe, expect, it } from 'vitest'
import { canonicalWorktreeIdentity } from '../../shared/worktree/identity'
import { mergeWorktree } from './worktree-metadata-merge'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'

const git = (over: Partial<GitWorktreeInfo> = {}): GitWorktreeInfo => ({
  path: '/repos/app',
  head: 'abc123',
  branch: 'refs/heads/task/WOLF-1910',
  isBare: false,
  isMainWorktree: true,
  ...over
})

const meta = (over: Partial<WorktreeMeta> = {}): WorktreeMeta => over as WorktreeMeta

describe('mergeWorktree attached reviews', () => {
  it('surfaces the persisted reviews so a caller can read back what it wrote', () => {
    // Why: this is the merge the CLI and the board both read through. Writing
    // the reviews but omitting them here persists data nothing can see, and
    // the additive --add-pr path reads the current list before merging.
    const merged = mergeWorktree(
      'repo-1',
      git(),
      meta({
        attachedReviews: [
          { provider: 'github', number: 294, url: 'https://github.com/acme/app/pull/294' },
          { provider: 'github', number: 295, url: 'https://github.com/acme/app/pull/295' }
        ]
      })
    )

    expect(merged.attachedReviews).toEqual([
      { provider: 'github', number: 294, url: 'https://github.com/acme/app/pull/294' },
      { provider: 'github', number: 295, url: 'https://github.com/acme/app/pull/295' }
    ])
  })

  it('drops corrupted entries instead of handing them to the renderer', () => {
    const merged = mergeWorktree(
      'repo-1',
      git(),
      meta({
        attachedReviews: [
          { provider: 'github', number: 294, url: 'https://github.com/acme/app/pull/294' },
          { provider: 'nope', number: 0, url: 'not-a-url' }
        ] as WorktreeMeta['attachedReviews']
      })
    )

    expect(merged.attachedReviews).toHaveLength(1)
  })

  it('omits the key when there is nothing attached', () => {
    // Why: every worktree list payload carries this merge, so an empty array on
    // each row is pure overhead. Absent and empty mean the same thing here.
    expect(mergeWorktree('repo-1', git(), meta({})).attachedReviews).toBeUndefined()
    expect(
      mergeWorktree('repo-1', git(), meta({ attachedReviews: [] })).attachedReviews
    ).toBeUndefined()
    expect(mergeWorktree('repo-1', git(), undefined).attachedReviews).toBeUndefined()
  })
})

const featureGit: GitWorktreeInfo = {
  path: '/workspace/feature',
  head: 'abc123',
  branch: 'refs/heads/feature',
  isBare: false,
  isMainWorktree: false
}

describe('mergeWorktree identity projection', () => {
  it('re-derives an automatic display name from the current branch', () => {
    const worktree = mergeWorktree(
      'repo-1',
      { ...featureGit, branch: 'refs/heads/main' },
      {
        displayName: 'feature',
        displayNameIsPinned: false,
        comment: '',
        linkedIssue: null,
        linkedPR: null,
        linkedLinearIssue: null,
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 0,
        lastActivityAt: 0
      }
    )

    expect(worktree.displayName).toBe('main')
    expect(worktree.displayNameMode).toBe('automatic')
  })

  it('treats legacy CLI labels as fixed display names', () => {
    const worktree = mergeWorktree('repo-1', featureGit, {
      displayName: 'feature',
      cliProvenance: { kind: 'created-by-cli', createdAt: 1 },
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0
    })

    expect(worktree.displayNameMode).toBe('fixed')
  })

  it('publishes canonical identity when host and instance metadata are known', () => {
    const worktree = mergeWorktree('repo-1', featureGit, {
      instanceId: '11111111-1111-4111-8111-111111111111',
      hostId: 'ssh:build-box',
      displayName: 'Feature',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0
    })

    expect(worktree.identity).toEqual({
      key: canonicalWorktreeIdentity({
        worktreeId: worktree.id,
        executionHostId: 'ssh:build-box',
        instanceId: '11111111-1111-4111-8111-111111111111'
      }),
      executionHostId: 'ssh:build-box',
      instanceId: '11111111-1111-4111-8111-111111111111'
    })
  })

  it('omits canonical identity for legacy metadata without a proven host', () => {
    const worktree = mergeWorktree('repo-1', featureGit, undefined)

    expect(worktree.identity).toBeUndefined()
  })

  it('projects optional GitHub PR suppression metadata', () => {
    const worktree = mergeWorktree('repo-1', featureGit, {
      displayName: 'Feature',
      comment: '',
      linkedIssue: null,
      linkedPR: null,
      suppressedGitHubPR: 42,
      linkedLinearIssue: null,
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0
    })

    expect(worktree.suppressedGitHubPR).toBe(42)
  })
})
