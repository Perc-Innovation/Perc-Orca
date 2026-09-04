import { describe, expect, it, vi } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import {
  adoptWorkspaceSessionRead,
  emptyWindowWorkspaceSession
} from '@/lib/empty-window-workspace-session'
import { partitionWorkspaceSessionByWorktrees } from '../../../../shared/workspace-session-window-rebase'
import type { WorkspaceSessionHostRead } from '@/lib/workspace-session-host-hydration'
import { worktreeWorkspaceKey } from '../../../../shared/workspace-scope'
import { createTestStore, makeWorktree, makeTab, makeLayout } from './store-test-helpers'
import { createStoreSessionMockApi } from './store-session-test-harness'

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }))

vi.mock('@/lib/agent-status', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentStatusModule>()
  return { ...actual, detectAgentStatusFromTitle: vi.fn().mockReturnValue(null) }
})

createStoreSessionMockApi()

const WORKTREE_ID = 'repo1::/path/wt1'

function seedCatalog(store: ReturnType<typeof createTestStore>): void {
  store.setState({
    repos: [{ id: 'repo1', path: '/repo1', displayName: 'Repo 1', badgeColor: '#000', addedAt: 0 }],
    worktreesByRepo: {
      repo1: [makeWorktree({ id: WORKTREE_ID, repoId: 'repo1', path: '/path/wt1' })]
    }
  })
}

function persistedSessionRead(): WorkspaceSessionHostRead {
  return {
    session: {
      activeRepoId: 'repo1',
      activeWorktreeId: WORKTREE_ID,
      activeWorkspaceKey: worktreeWorkspaceKey(WORKTREE_ID),
      activeTabId: 'tab-1',
      tabsByWorktree: { [WORKTREE_ID]: [makeTab({ id: 'tab-1', worktreeId: WORKTREE_ID })] },
      terminalLayoutsByTabId: { 'tab-1': makeLayout() },
      activeConnectionIdsAtShutdown: ['ssh-target-1'],
      lastVisitedAtByWorktreeId: { [WORKTREE_ID]: 1_700_000_000_000 },
      defaultTerminalTabsAppliedByWorktreeId: { [WORKTREE_ID]: true }
    },
    runtimeHostIdByWorkspaceSessionKey: {},
    contestedHostWorkspaceSessions: {},
    contestedPrimaryHostBySessionKey: {}
  }
}

describe('startup hydration for a project window', () => {
  it('hydrates the project window with its own project, not an empty session', () => {
    const store = createTestStore()
    seedCatalog(store)

    // Main partitions the read by the window's scope; this is the half it receives.
    const scoped = partitionWorkspaceSessionByWorktrees(
      persistedSessionRead().session,
      new Set([WORKTREE_ID])
    ).owned
    store.getState().hydrateWorkspaceSession(scoped)
    store.getState().hydrateTabsSession(scoped)

    const state = store.getState()
    expect(state.tabsByWorktree[WORKTREE_ID]).toHaveLength(1)
    // Why the focus follows: without it the window hydrates its tabs with nothing selected.
    expect(state.activeWorktreeId).toBe(WORKTREE_ID)
    expect(state.activeTabId).toBe('tab-1')
  })

  it('leaves the free window with nothing once a project window serves that worktree', () => {
    const store = createTestStore()
    seedCatalog(store)

    const rest = partitionWorkspaceSessionByWorktrees(
      persistedSessionRead().session,
      new Set([WORKTREE_ID])
    ).rest
    store.getState().hydrateWorkspaceSession(rest)
    store.getState().hydrateTabsSession(rest)

    const state = store.getState()
    expect(state.tabsByWorktree).toEqual({})
    expect(state.unifiedTabsByWorktree).toEqual({})
    expect(state.pendingReconnectWorktreeIds).toEqual([])
  })

  it('keeps the ledgers a window with no project of its own still needs', () => {
    // The carry/drop policy outlived the projection: it is what forces a new session field to be
    // classified rather than leaking into a window that has no project.
    const projected = emptyWindowWorkspaceSession(persistedSessionRead().session)

    // Why: dropping this one re-runs the repo's default tab template — and its commands.
    expect(projected.defaultTerminalTabsAppliedByWorktreeId).toEqual({ [WORKTREE_ID]: true })
    expect(projected.lastVisitedAtByWorktreeId).toEqual({ [WORKTREE_ID]: 1_700_000_000_000 })
    expect(projected.tabsByWorktree).toEqual({})
  })

  it('hands the free window the whole read when no project window is up', () => {
    const store = createTestStore()
    seedCatalog(store)

    const persisted = persistedSessionRead()
    const read = adoptWorkspaceSessionRead(persisted, 'shared')
    expect(read).toBe(persisted)

    store.getState().hydrateWorkspaceSession(read.session)

    const state = store.getState()
    expect(state.activeWorktreeId).toBe(WORKTREE_ID)
    expect(state.activeRepoId).toBe('repo1')
    expect(state.activeTabId).toBe('tab-1')
    expect(state.tabsByWorktree[WORKTREE_ID]).toHaveLength(1)
    expect(read.session.activeConnectionIdsAtShutdown).toEqual(['ssh-target-1'])
  })
})
