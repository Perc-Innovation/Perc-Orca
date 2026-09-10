/**
 * Under an armed topology fence, a renderer write that omits a terminal row is a stale replay
 * to the membership rebase, and the row survives it. The retirement channel is how a user close
 * outranks that: by tab id, without waiting for a PTY exit that may never come.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { createStore, testState } from '../persistence-test-harness'
import { retireTerminalTabFromWorkspaceSession } from './session-terminal-tab-retirement'

vi.mock('electron', () => ({
  app: { getPath: () => testStateDirRef.dir, getName: () => 'orca', getVersion: () => '0.0.0' },
  BrowserWindow: { fromId: () => null, getAllWindows: () => [] },
  webContents: { fromId: () => null },
  ipcMain: { on: () => {}, handle: () => {}, removeListener: () => {} },
  safeStorage: { isEncryptionAvailable: () => false }
}))

const testStateDirRef = vi.hoisted(() => ({ dir: '' }))

const REPO_ID = 'repo-1'
const WT = `${REPO_ID}::/tmp/wt`
const TAB = 'tab-1'
const LEAF = '11111111-1111-4111-8111-111111111111'
const PTY = `${WT}@@a1b2c3d4`

/** A renderer session write after closing `tabId`: the row is gone, the fence is never written. */
function rendererWriteWithout(
  session: WorkspaceSessionState,
  tabId: string
): WorkspaceSessionState {
  const next: WorkspaceSessionState = {
    ...session,
    tabsByWorktree: {
      ...session.tabsByWorktree,
      [WT]: (session.tabsByWorktree?.[WT] ?? []).filter((tab) => tab.id !== tabId)
    }
  }
  delete (next as { terminalTopologyRevisionByRepoId?: unknown }).terminalTopologyRevisionByRepoId
  return next
}

function tabIds(session: WorkspaceSessionState): string[] {
  return (session.tabsByWorktree?.[WT] ?? []).map((tab) => tab.id)
}

describe('retireTerminalTabFromWorkspaceSession', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-tab-retirement-'))
    testStateDirRef.dir = testState.dir
  })

  afterEach(() => {
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('removes the row under an armed fence, and later renderer writes cannot bring it back', async () => {
    const store = await createStore()
    store.setWorkspaceSession({
      ...store.getWorkspaceSession(),
      terminalTopologyRevisionByRepoId: { [REPO_ID]: 1 }
    })
    store.persistPtyBinding({ worktreeId: WT, tabId: TAB, leafId: LEAF, ptyId: PTY })
    // The pre-existing behavior this channel exists for: the close alone is rebased away.
    store.setWorkspaceSession(rendererWriteWithout(store.getWorkspaceSession(), TAB))
    expect(tabIds(store.getWorkspaceSession())).toContain(TAB)

    const fenceBefore = store.getWorkspaceSession().terminalTopologyRevisionByRepoId?.[REPO_ID] ?? 0
    const result = retireTerminalTabFromWorkspaceSession(store, { worktreeId: WT, tabId: TAB })

    expect(result).toEqual({ retired: true, reason: 'retired' })
    expect(tabIds(store.getWorkspaceSession())).toEqual([])
    // Why greater and not a number: an armed fence keeps climbing on every binding, and the
    // retirement has to outrank whatever it reached.
    expect(store.getWorkspaceSession().terminalTopologyRevisionByRepoId?.[REPO_ID]).toBeGreaterThan(
      fenceBefore
    )
    for (let i = 0; i < 3; i += 1) {
      store.setWorkspaceSession(rendererWriteWithout(store.getWorkspaceSession(), TAB))
    }
    expect(tabIds(store.getWorkspaceSession())).toEqual([])
  })

  it('leaves a repo the renderer still owns alone, and does not arm its fence', async () => {
    const store = await createStore()
    store.persistPtyBinding({ worktreeId: WT, tabId: TAB, leafId: LEAF, ptyId: PTY })

    const result = retireTerminalTabFromWorkspaceSession(store, { worktreeId: WT, tabId: TAB })

    expect(result).toEqual({ retired: false, reason: 'renderer-authoritative' })
    expect(tabIds(store.getWorkspaceSession())).toContain(TAB)
    expect(store.getWorkspaceSession().terminalTopologyRevisionByRepoId?.[REPO_ID] ?? 0).toBe(0)
    // The renderer's own write is the close here, exactly as before.
    store.setWorkspaceSession(rendererWriteWithout(store.getWorkspaceSession(), TAB))
    expect(tabIds(store.getWorkspaceSession())).toEqual([])
  })

  it('reports a row it cannot find without touching the fence', async () => {
    const store = await createStore()
    store.setWorkspaceSession({
      ...store.getWorkspaceSession(),
      terminalTopologyRevisionByRepoId: { [REPO_ID]: 5 }
    })

    const result = retireTerminalTabFromWorkspaceSession(store, { worktreeId: WT, tabId: 'nope' })

    expect(result).toEqual({ retired: false, reason: 'absent' })
    expect(store.getWorkspaceSession().terminalTopologyRevisionByRepoId?.[REPO_ID]).toBe(5)
  })
})
