import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as AgentStatusModule from '@/lib/agent-status'
import { createTestStore, makeTab, makeWorktree, seedStore } from '../slices/store-test-helpers'
import { createStoreCascadesMockApi } from '../slices/store-cascades-test-harness'

/**
 * A user close reaches main by tab id, whether or not the PTY is still alive: the durable
 * de-persist no longer rides the PTY exit alone.
 */

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn() }
}))

vi.mock('@/components/terminal-pane/pty-dispatcher', () => ({
  restorePtyDataHandlersAfterFailedShutdown: vi.fn(),
  unregisterPtyDataHandlers: vi.fn<() => unknown[]>(() => [])
}))

vi.mock('@/lib/agent-status', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentStatusModule>()),
  detectAgentStatusFromTitle: vi.fn().mockReturnValue(null)
}))

const mockApi = createStoreCascadesMockApi()
const retireTerminalTab = vi.fn(async () => ({ retired: true }))
;(mockApi as unknown as { session: unknown }).session = { retireTerminalTab }

const LOCAL_WORKTREE = 'local-repo::/tmp/app'

function storeWithLocalTab(): ReturnType<typeof createTestStore> {
  const store = createTestStore()
  seedStore(store, {
    repos: [{ id: 'local-repo', path: '/tmp/app', name: 'app' }] as never,
    worktreesByRepo: {
      'local-repo': [makeWorktree({ id: LOCAL_WORKTREE, repoId: 'local-repo', path: '/tmp/app' })]
    },
    tabsByWorktree: {
      [LOCAL_WORKTREE]: [makeTab({ id: 'local-tab', worktreeId: LOCAL_WORKTREE })]
    }
  })
  return store
}

describe('closeTab durable retirement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.worktrees.updateMeta.mockResolvedValue({})
  })

  it('tells main which tab the user closed, keyed by tab id', () => {
    const store = storeWithLocalTab()

    store.getState().closeTab('local-tab')

    // No hostId for a local worktree: main defaults the partition, as every session write does.
    expect(retireTerminalTab).toHaveBeenCalledWith({
      worktreeId: LOCAL_WORKTREE,
      tabId: 'local-tab'
    })
  })

  it('says nothing for a pty-exit close, which is the process ending and not a decision', () => {
    const store = storeWithLocalTab()

    store.getState().closeTab('local-tab', { reason: 'pty-exit' })

    expect(retireTerminalTab).not.toHaveBeenCalled()
  })

  it('says nothing when main drove the close and already retired the row', () => {
    const store = storeWithLocalTab()

    store.getState().closeTab('local-tab', { localPtyTeardownOwnedExternally: true })

    expect(retireTerminalTab).not.toHaveBeenCalled()
  })
})
