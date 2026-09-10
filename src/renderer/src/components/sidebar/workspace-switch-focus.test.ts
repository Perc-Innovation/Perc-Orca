import { describe, expect, it } from 'vitest'
import { pickWorkspaceFocusOnSwitch } from './workspace-switch-focus'
import type { WorkspaceOption } from './workspace-selection'

type FocusState = Parameters<typeof pickWorkspaceFocusOnSwitch>[1]

/**
 * What the content area shows after a workspace switch: the workspace last visited inside the
 * chosen one, with something open — or nothing, which is the welcome screen.
 */

const GROUPS = [
  { id: 'perc', parentGroupId: null, name: 'Perc', tabOrder: 0 },
  {
    id: 'perc-tools',
    parentGroupId: 'perc',
    name: 'Perc (Tools)',
    tabOrder: 1
  },
  { id: 'cce', parentGroupId: null, name: 'CCE', tabOrder: 2 }
]

const REPOS = [
  { id: 'repo-pay', projectGroupId: 'perc' },
  { id: 'repo-cli', projectGroupId: 'perc-tools' },
  { id: 'repo-api', projectGroupId: 'cce' },
  { id: 'repo-suelto', projectGroupId: null }
]

const FOLDER_WORKSPACES = [{ id: 'tasks', projectGroupId: 'perc' }]

const PERC: WorkspaceOption = { kind: 'group', id: 'perc', name: 'Perc' }
const CCE: WorkspaceOption = { kind: 'group', id: 'cce', name: 'CCE' }
const UNGROUPED: WorkspaceOption = {
  kind: 'ungrouped',
  id: null,
  repoIds: ['repo-suelto']
}

const tab = { id: 't' }

function stateWith(overrides: Partial<Record<keyof FocusState, unknown>> = {}): FocusState {
  const known = new Set([
    'repo-pay::/w/pay',
    'repo-cli::/w/cli',
    'repo-api::/w/api',
    'repo-suelto::/w/suelto',
    'folder:tasks'
  ])
  return {
    repos: REPOS,
    projectGroups: GROUPS,
    folderWorkspaces: FOLDER_WORKSPACES,
    tabsByWorktree: {
      'repo-pay::/w/pay': [tab],
      'repo-cli::/w/cli': [tab],
      'repo-api::/w/api': [tab],
      'repo-suelto::/w/suelto': [tab],
      'folder:tasks': [tab]
    },
    unifiedTabsByWorktree: {},
    lastVisitedAtByWorktreeId: {},
    getKnownWorktreeById: (id: string) => (known.has(id) ? { id } : undefined),
    ...overrides
  } as unknown as FocusState
}

describe('pickWorkspaceFocusOnSwitch', () => {
  it('lands on the most recently visited workspace inside the chosen one', () => {
    const state = stateWith({
      lastVisitedAtByWorktreeId: {
        'repo-pay::/w/pay': 10,
        'repo-cli::/w/cli': 30,
        'repo-api::/w/api': 50
      }
    })

    // repo-cli hangs off a subgroup and still belongs to Perc; CCE's newer visit does not count.
    expect(pickWorkspaceFocusOnSwitch(PERC, state)).toEqual({
      key: 'repo-cli::/w/cli'
    })
  })

  it('counts a folder workspace by the group it carries itself', () => {
    const state = stateWith({
      lastVisitedAtByWorktreeId: { 'folder:tasks': 99, 'repo-pay::/w/pay': 10 }
    })

    expect(pickWorkspaceFocusOnSwitch(PERC, state)).toEqual({
      key: 'folder:tasks'
    })
  })

  it('reads host-qualified recency and hands the host back for activation', () => {
    const state = stateWith({
      lastVisitedAtByWorktreeId: { 'ssh-1|repo-api::/w/api': 5 },
      getKnownWorktreeById: (id: string) =>
        id === 'repo-api::/w/api' ? { id, hostId: 'ssh-1' } : undefined
    })

    expect(pickWorkspaceFocusOnSwitch(CCE, state)).toEqual({
      key: 'repo-api::/w/api',
      hostId: 'ssh-1'
    })
  })

  it('picks the ungrouped projects by repo, never a folder workspace', () => {
    const state = stateWith({
      lastVisitedAtByWorktreeId: {
        'folder:tasks': 99,
        'repo-suelto::/w/suelto': 1
      }
    })

    expect(pickWorkspaceFocusOnSwitch(UNGROUPED, state)).toEqual({
      key: 'repo-suelto::/w/suelto'
    })
  })

  it('returns nothing for a workspace with nothing open, so the welcome shows', () => {
    const state = stateWith({ tabsByWorktree: {}, unifiedTabsByWorktree: {} })

    expect(pickWorkspaceFocusOnSwitch(CCE, state)).toBeNull()
  })

  it('treats an open editor or browser tab as something open', () => {
    const state = stateWith({
      tabsByWorktree: {},
      unifiedTabsByWorktree: { 'repo-api::/w/api': [tab] }
    })

    expect(pickWorkspaceFocusOnSwitch(CCE, state)).toEqual({
      key: 'repo-api::/w/api'
    })
  })

  it('skips a key whose workspace no longer exists', () => {
    const state = stateWith({
      lastVisitedAtByWorktreeId: { 'repo-api::/w/api': 5 },
      getKnownWorktreeById: () => undefined
    })

    expect(pickWorkspaceFocusOnSwitch(CCE, state)).toBeNull()
  })

  it('breaks a never-visited tie by key so the answer does not depend on record order', () => {
    const state = stateWith({
      tabsByWorktree: { 'repo-cli::/w/cli': [tab], 'repo-pay::/w/pay': [tab] }
    })

    expect(pickWorkspaceFocusOnSwitch(PERC, state)).toEqual({
      key: 'repo-cli::/w/cli'
    })
  })
})
