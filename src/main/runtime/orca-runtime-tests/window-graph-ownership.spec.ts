import { describe, expect, it, vi } from 'vitest'
import {
  FOLDER_WORKSPACE_INSTANCE_SEPARATOR,
  OrcaRuntimeService,
  listWorktrees,
  type WorktreeMeta
} from '../orca-runtime-test-mocks.spec'
import {
  TEST_REPO_ID,
  TEST_REPO_PATH,
  TEST_WINDOW_ID,
  createRuntime,
  makeWorktreeInfo,
  makeWorktreeMeta,
  store
} from '../orca-runtime-test-fixtures.spec'

function singleTabGraph(tabId: string, worktreeId: string, ptyId: string, paneRuntimeId = 1) {
  return {
    tabs: [{ tabId, worktreeId, title: tabId, activeLeafId: 'pane:1', layout: null }],
    leaves: [{ tabId, worktreeId, leafId: 'pane:1', paneRuntimeId, ptyId }]
  }
}

describe('OrcaRuntimeService', () => {
  it('accepts graph publications from every attached window', () => {
    const runtime = createRuntime()

    runtime.attachWindow(TEST_WINDOW_ID)
    runtime.syncWindowGraph(TEST_WINDOW_ID, { tabs: [], leaves: [] })
    runtime.attachWindow(2)

    expect(() => runtime.syncWindowGraph(2, { tabs: [], leaves: [] })).not.toThrow()
    expect(runtime.getStatus()).toMatchObject({
      authoritativeWindowId: TEST_WINDOW_ID,
      graphStatus: 'ready'
    })
  })

  it('indexes independent graph ownership from secondary window syncs', () => {
    const runtime = createRuntime()

    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, singleTabGraph('tab-a', 'repo-1::/tmp/worktree-a', 'pty-a'))
    runtime.attachWindow(2)
    runtime.syncWindowGraph(2, singleTabGraph('tab-b', 'repo-1::/tmp/worktree-b', 'pty-b'))

    expect(runtime.getStatus()).toMatchObject({
      authoritativeWindowId: 1,
      graphStatus: 'ready',
      liveTabCount: 2,
      liveLeafCount: 2
    })
    expect(runtime.resolveOwnerWindowIdForTabId('tab-a')).toBe(1)
    expect(runtime.resolveOwnerWindowIdForTabId('tab-b')).toBe(2)
    expect(runtime.resolveOwnerWindowIdForWorktreeTab('repo-1::/tmp/worktree-b', 'tab-b')).toBe(2)
    expect(runtime.resolveOwnerWindowIdForLeaf('tab-b', 'pane:1')).toBe(2)
    expect(runtime.resolveOwnerWindowIdForPtyId('pty-b')).toBe(2)
  })

  it('keeps the first live owner when two windows publish duplicate graph ids', () => {
    const runtime = createRuntime()

    runtime.attachWindow(1)
    runtime.syncWindowGraph(
      1,
      singleTabGraph('tab-duplicate', 'repo-1::/tmp/worktree-a', 'pty-duplicate')
    )
    runtime.attachWindow(2)
    runtime.syncWindowGraph(
      2,
      singleTabGraph('tab-duplicate', 'repo-1::/tmp/worktree-a', 'pty-duplicate', 2)
    )

    expect(runtime.getStatus()).toMatchObject({ liveTabCount: 1, liveLeafCount: 1 })
    expect(runtime.resolveOwnerWindowIdForTabId('tab-duplicate')).toBe(1)
    expect(runtime.resolveOwnerWindowIdForLeaf('tab-duplicate', 'pane:1')).toBe(1)
    expect(runtime.resolveOwnerWindowIdForPtyId('pty-duplicate')).toBe(1)
  })

  it('preserves spawn-time PTY ownership until the renderer graph adopts it', () => {
    const runtime = createRuntime()

    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    runtime.registerPtyOwnerWindow('pty-spawned', 1)
    runtime.attachWindow(2)
    runtime.syncWindowGraph(2, {
      tabs: [
        {
          tabId: 'tab-other',
          worktreeId: 'repo-1::/tmp/worktree-b',
          title: 'B',
          activeLeafId: 'pane:1',
          layout: null
        }
      ],
      leaves: []
    })

    expect(runtime.resolveOwnerWindowIdForPtyId('pty-spawned')).toBe(1)

    runtime.syncWindowGraph(
      1,
      singleTabGraph('tab-owned', 'repo-1::/tmp/worktree-a', 'pty-spawned')
    )

    expect(runtime.resolveOwnerWindowIdForPtyId('pty-spawned')).toBe(1)
  })

  it('clears transient PTY ownership when the owning window graph disappears', () => {
    const runtime = createRuntime()

    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, { tabs: [], leaves: [] })
    runtime.registerPtyOwnerWindow('pty-spawned', 1)

    expect(runtime.resolveOwnerWindowIdForPtyId('pty-spawned')).toBe(1)

    runtime.markGraphUnavailable(1)

    expect(runtime.resolveOwnerWindowIdForPtyId('pty-spawned')).toBeNull()
  })

  it('keeps another window graph ready when a secondary window closes', () => {
    const runtime = createRuntime()

    runtime.attachWindow(1)
    runtime.syncWindowGraph(1, singleTabGraph('tab-a', 'repo-1::/tmp/worktree-a', 'pty-a'))
    runtime.attachWindow(2)
    runtime.syncWindowGraph(2, singleTabGraph('tab-b', 'repo-1::/tmp/worktree-b', 'pty-b'))

    runtime.markGraphUnavailable(2)

    expect(runtime.getStatus()).toMatchObject({
      authoritativeWindowId: 1,
      graphStatus: 'ready',
      liveTabCount: 1,
      liveLeafCount: 1
    })
    expect(runtime.resolveOwnerWindowIdForPtyId('pty-a')).toBe(1)
    expect(runtime.resolveOwnerWindowIdForPtyId('pty-b')).toBeNull()
  })

  // `orca worktree ps` and `orca terminal create --worktree` both read the resolved catalog, so a
  // terminal group only reaches the CLI if the git scan's rows are joined by its meta-backed row.
  it('lists a git project terminal group next to its checkouts', async () => {
    const terminalGroupId = `${TEST_REPO_ID}::${TEST_REPO_PATH}${FOLDER_WORKSPACE_INSTANCE_SEPARATOR}44444444-4444-4444-8444-444444444444`
    const metaById: Record<string, WorktreeMeta> = {
      ...store.getAllWorktreeMeta(),
      [terminalGroupId]: makeWorktreeMeta({
        instanceId: '44444444-4444-4444-8444-444444444444',
        displayName: 'servers'
      })
    }
    vi.mocked(listWorktrees).mockClear()
    vi.mocked(listWorktrees).mockResolvedValue([makeWorktreeInfo(TEST_REPO_PATH)])
    const runtime = new OrcaRuntimeService({
      ...store,
      getAllWorktreeMeta: () => metaById,
      getWorktreeMeta: (id: string) => metaById[id],
      setWorktreeMeta: (id: string, meta: Partial<WorktreeMeta>) => {
        metaById[id] = { ...(metaById[id] ?? makeWorktreeMeta()), ...meta }
        return metaById[id]
      }
    } as never)

    const listed = await runtime.listManagedWorktrees(`id:${TEST_REPO_ID}`)

    expect(listed.worktrees).toContainEqual(
      expect.objectContaining({
        id: terminalGroupId,
        repoId: TEST_REPO_ID,
        path: TEST_REPO_PATH,
        displayName: 'servers',
        branch: '',
        isMainWorktree: false
      })
    )
  })
})
