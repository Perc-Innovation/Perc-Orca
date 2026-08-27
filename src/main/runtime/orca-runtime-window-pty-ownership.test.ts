import { describe, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from './orca-runtime'
import type { PtyOwnerWindowChange } from './window-pty-ownership-priority'
import type { RuntimeSyncWindowGraph } from '../../shared/runtime-session-contracts'

const FREE_WINDOW = 1
const PERC_WINDOW = 2
const PERC_GROUP = 'group-perc'
const BANK_GROUP = 'group-bank'
const PERC_WORKTREE = 'perc-repo::/tmp/perc/main'
const BANK_WORKTREE = 'bank-repo::/tmp/bank/main'
const PERC_FOLDER_WORKSPACE = 'folder:perc-tasks'
const ORPHAN_WORKTREE = 'orphan-repo::/tmp/orphan'

const repos = [
  { id: 'perc-repo', path: '/tmp/perc', displayName: 'perc', projectGroupId: PERC_GROUP },
  { id: 'bank-repo', path: '/tmp/bank', displayName: 'bank', projectGroupId: BANK_GROUP },
  { id: 'orphan-repo', path: '/tmp/orphan', displayName: 'orphan', projectGroupId: null }
]

const store = {
  getRepos: () => repos,
  getRepo: (id: string) => repos.find((repo) => repo.id === id),
  getProjectGroups: () => [
    { id: PERC_GROUP, name: 'Perc' },
    { id: BANK_GROUP, name: 'Bank' }
  ],
  getFolderWorkspaces: () => [
    { id: 'perc-tasks', projectGroupId: PERC_GROUP, name: 'Tasks', folderPath: '/tmp/perc' }
  ],
  addRetiredWorktreeName: () => {},
  getRetiredWorktreeNameRegistry: () => ({ exhaustedTiers: 0, names: [] }),
  mergeRetiredWorktreeNames: () => false,
  addRepo: () => {},
  updateRepo: () => ({}) as never,
  getAllWorktreeMeta: () => ({}),
  getWorktreeMeta: () => undefined,
  setWorktreeMeta: () => ({}) as never,
  removeWorktreeMeta: () => {},
  getGitHubCache: () => ({}) as never
}

type Harness = {
  runtime: OrcaRuntimeService
  scopes: Map<number, string | null>
  changes: PtyOwnerWindowChange[][]
}

function createHarness(options: { scopedWindows?: boolean } = {}): Harness {
  const scopes = new Map<number, string | null>()
  const changes: PtyOwnerWindowChange[][] = []
  const runtime = new OrcaRuntimeService(store as never, undefined, {
    resolveWindowProjectGroupId:
      options.scopedWindows === false ? undefined : (windowId) => scopes.get(windowId) ?? null,
    onPtyOwnerWindowsChanged: (batch) => changes.push(batch)
  })
  return { runtime, scopes, changes }
}

function graph(
  entries: { tabId: string; worktreeId: string; ptyId: string | null }[]
): RuntimeSyncWindowGraph {
  return {
    tabs: entries.map(({ tabId, worktreeId }) => ({
      tabId,
      worktreeId,
      title: tabId,
      activeLeafId: 'pane:1',
      layout: null
    })),
    leaves: entries.map(({ tabId, worktreeId, ptyId }) => ({
      tabId,
      worktreeId,
      leafId: 'pane:1',
      paneRuntimeId: 1,
      ptyId
    }))
  }
}

const EVERYTHING = [
  { tabId: 'tab-perc', worktreeId: PERC_WORKTREE, ptyId: 'pty-perc' },
  { tabId: 'tab-bank', worktreeId: BANK_WORKTREE, ptyId: 'pty-bank' },
  { tabId: 'tab-folder', worktreeId: PERC_FOLDER_WORKSPACE, ptyId: 'pty-folder' },
  { tabId: 'tab-orphan', worktreeId: ORPHAN_WORKTREE, ptyId: 'pty-orphan' }
]

/** The free window publishes first, then a window bound to Perc publishes the same graph. */
function publishFreeThenPerc(harness: Harness): void {
  harness.runtime.attachWindow(FREE_WINDOW)
  harness.runtime.syncWindowGraph(FREE_WINDOW, graph(EVERYTHING))
  harness.scopes.set(PERC_WINDOW, PERC_GROUP)
  harness.runtime.attachWindow(PERC_WINDOW)
  harness.runtime.syncWindowGraph(PERC_WINDOW, graph(EVERYTHING))
}

function owners(runtime: OrcaRuntimeService): Record<string, number | null> {
  return Object.fromEntries(
    ['pty-perc', 'pty-bank', 'pty-folder', 'pty-orphan'].map((ptyId) => [
      ptyId,
      runtime.resolveOwnerWindowIdForPtyId(ptyId)
    ])
  )
}

describe('window ownership priority in the runtime owner index', () => {
  it('gives a project window its own PTYs even though the free window published first', () => {
    const harness = createHarness()
    publishFreeThenPerc(harness)

    expect(owners(harness.runtime)).toEqual({
      'pty-perc': PERC_WINDOW,
      'pty-folder': PERC_WINDOW,
      'pty-bank': FREE_WINDOW,
      'pty-orphan': FREE_WINDOW
    })
    expect(harness.runtime.resolveOwnerWindowIdForTabId('tab-perc')).toBe(PERC_WINDOW)
    expect(harness.runtime.resolveOwnerWindowIdForLeaf('tab-perc', 'pane:1')).toBe(PERC_WINDOW)
    expect(harness.runtime.resolveOwnerWindowIdForWorktreeTab(PERC_WORKTREE, 'tab-perc')).toBe(
      PERC_WINDOW
    )
    expect(harness.runtime.resolveOwnerWindowIdForTabId('tab-bank')).toBe(FREE_WINDOW)
  })

  it('reports the hand-off so delivery accounting and renderers can follow', () => {
    const harness = createHarness()
    publishFreeThenPerc(harness)

    expect(harness.changes.flat()).toContainEqual({
      ptyId: 'pty-perc',
      previousWindowId: FREE_WINDOW,
      nextWindowId: PERC_WINDOW
    })
    expect(harness.changes.flat()).toContainEqual({
      ptyId: 'pty-folder',
      previousWindowId: FREE_WINDOW,
      nextWindowId: PERC_WINDOW
    })
    expect(harness.changes.flat().filter((change) => change.ptyId === 'pty-bank')).toEqual([
      { ptyId: 'pty-bank', previousWindowId: null, nextWindowId: FREE_WINDOW }
    ])
  })

  it('re-resolves on a scope rebind: "change project" moves ownership, "free mode" returns it', () => {
    const harness = createHarness()
    publishFreeThenPerc(harness)

    harness.scopes.set(PERC_WINDOW, BANK_GROUP)
    harness.runtime.handleWindowScopesChanged()
    expect(owners(harness.runtime)).toEqual({
      'pty-perc': FREE_WINDOW,
      'pty-folder': FREE_WINDOW,
      'pty-bank': PERC_WINDOW,
      'pty-orphan': FREE_WINDOW
    })

    harness.scopes.set(PERC_WINDOW, null)
    harness.runtime.handleWindowScopesChanged()
    expect(owners(harness.runtime)).toEqual({
      'pty-perc': FREE_WINDOW,
      'pty-folder': FREE_WINDOW,
      'pty-bank': FREE_WINDOW,
      'pty-orphan': FREE_WINDOW
    })
    expect(harness.changes.at(-1)).toEqual([
      { ptyId: 'pty-bank', previousWindowId: PERC_WINDOW, nextWindowId: FREE_WINDOW }
    ])
  })

  it('changes nothing when the scope resolver is absent (flag off)', () => {
    const harness = createHarness({ scopedWindows: false })
    publishFreeThenPerc(harness)

    expect(owners(harness.runtime)).toEqual({
      'pty-perc': FREE_WINDOW,
      'pty-folder': FREE_WINDOW,
      'pty-bank': FREE_WINDOW,
      'pty-orphan': FREE_WINDOW
    })
    harness.runtime.handleWindowScopesChanged()
    expect(harness.changes.flat().every((change) => change.previousWindowId === null)).toBe(true)
  })

  it('is invisible with a single window, scoped or not', () => {
    const harness = createHarness()
    harness.scopes.set(PERC_WINDOW, PERC_GROUP)
    harness.runtime.attachWindow(PERC_WINDOW)
    harness.runtime.syncWindowGraph(PERC_WINDOW, graph(EVERYTHING))
    const first = owners(harness.runtime)

    harness.runtime.handleWindowScopesChanged()
    harness.runtime.syncWindowGraph(PERC_WINDOW, graph(EVERYTHING))

    expect(first).toEqual({
      'pty-perc': PERC_WINDOW,
      'pty-folder': PERC_WINDOW,
      'pty-bank': PERC_WINDOW,
      'pty-orphan': PERC_WINDOW
    })
    expect(owners(harness.runtime)).toEqual(first)
    expect(harness.changes).toHaveLength(1)
    expect(harness.changes[0]!.every((change) => change.previousWindowId === null)).toBe(true)
  })

  it('never lets a scoped window take a PTY it does not publish', () => {
    const harness = createHarness()
    harness.runtime.attachWindow(FREE_WINDOW)
    harness.runtime.syncWindowGraph(FREE_WINDOW, graph(EVERYTHING))
    harness.scopes.set(PERC_WINDOW, PERC_GROUP)
    harness.runtime.attachWindow(PERC_WINDOW)
    harness.runtime.syncWindowGraph(PERC_WINDOW, graph([EVERYTHING[2]!]))

    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-folder')).toBe(PERC_WINDOW)
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-perc')).toBe(FREE_WINDOW)
  })
})

describe('explicit "bring here" claims', () => {
  it('outranks project scope and survives later rebuilds', () => {
    const harness = createHarness()
    publishFreeThenPerc(harness)

    expect(harness.runtime.claimPtyOwnerWindow('pty-perc', FREE_WINDOW)).toBe('claimed')
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-perc')).toBe(FREE_WINDOW)
    expect(harness.changes.at(-1)).toEqual([
      { ptyId: 'pty-perc', previousWindowId: PERC_WINDOW, nextWindowId: FREE_WINDOW }
    ])

    harness.runtime.syncWindowGraph(PERC_WINDOW, graph(EVERYTHING))
    harness.runtime.handleWindowScopesChanged()
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-perc')).toBe(FREE_WINDOW)
  })

  it('is reversible: A, then B, then A again', () => {
    const harness = createHarness()
    publishFreeThenPerc(harness)

    expect(harness.runtime.claimPtyOwnerWindow('pty-bank', PERC_WINDOW)).toBe('claimed')
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-bank')).toBe(PERC_WINDOW)
    expect(harness.runtime.claimPtyOwnerWindow('pty-bank', FREE_WINDOW)).toBe('claimed')
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-bank')).toBe(FREE_WINDOW)
    expect(harness.runtime.claimPtyOwnerWindow('pty-bank', PERC_WINDOW)).toBe('claimed')
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-bank')).toBe(PERC_WINDOW)
    expect(harness.runtime.claimPtyOwnerWindow('pty-bank', PERC_WINDOW)).toBe('already-owner')
  })

  it('refuses a window that does not publish a pane for the PTY', () => {
    const harness = createHarness()
    harness.runtime.attachWindow(FREE_WINDOW)
    harness.runtime.syncWindowGraph(FREE_WINDOW, graph(EVERYTHING))
    harness.runtime.attachWindow(PERC_WINDOW)
    harness.runtime.syncWindowGraph(PERC_WINDOW, graph([EVERYTHING[0]!]))

    expect(harness.runtime.claimPtyOwnerWindow('pty-bank', PERC_WINDOW)).toBe('unavailable')
    expect(harness.runtime.claimPtyOwnerWindow('pty-bank', 99)).toBe('unavailable')
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-bank')).toBe(FREE_WINDOW)
  })

  it('dies with the claiming window: the PTY falls back to scope, else arrival order', () => {
    const harness = createHarness()
    publishFreeThenPerc(harness)
    harness.runtime.claimPtyOwnerWindow('pty-perc', FREE_WINDOW)
    harness.runtime.claimPtyOwnerWindow('pty-bank', PERC_WINDOW)

    harness.runtime.markGraphUnavailable(FREE_WINDOW)
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-perc')).toBe(PERC_WINDOW)

    harness.runtime.attachWindow(FREE_WINDOW)
    harness.runtime.syncWindowGraph(FREE_WINDOW, graph(EVERYTHING))
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-perc')).toBe(PERC_WINDOW)
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-bank')).toBe(PERC_WINDOW)

    harness.runtime.markGraphUnavailable(PERC_WINDOW)
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-bank')).toBe(FREE_WINDOW)
  })

  it('survives "free mode" on the claiming window', () => {
    const harness = createHarness()
    publishFreeThenPerc(harness)
    harness.runtime.claimPtyOwnerWindow('pty-bank', PERC_WINDOW)

    harness.scopes.set(PERC_WINDOW, null)
    harness.runtime.handleWindowScopesChanged()

    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-bank')).toBe(PERC_WINDOW)
    expect(harness.runtime.resolveOwnerWindowIdForPtyId('pty-perc')).toBe(FREE_WINDOW)
  })

  it('lists the resolved owners for renderer hydration', () => {
    const harness = createHarness()
    publishFreeThenPerc(harness)
    const listener = vi.fn()
    harness.runtime.listPtyOwnerWindows().forEach(listener)

    expect(listener).toHaveBeenCalledWith(
      { ptyId: 'pty-perc', windowId: PERC_WINDOW },
      0,
      expect.anything()
    )
    expect(harness.runtime.listPtyOwnerWindows()).toContainEqual({
      ptyId: 'pty-bank',
      windowId: FREE_WINDOW
    })
  })
})
