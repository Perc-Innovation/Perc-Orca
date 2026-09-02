import { describe, expect, it } from 'vitest'
import {
  buildWorkspaceOptions,
  resolveActiveWorkspace,
  resolveWorkspaceForActiveWorkspaceKey,
  rootGroupIdOf,
  workspaceSelectionFilter
} from './workspace-selection'

const GROUPS = [
  { id: 'perc', parentGroupId: null, name: 'Perc', tabOrder: 0 },
  { id: 'perc-tools', parentGroupId: 'perc', name: 'Perc (Tools)', tabOrder: 1 },
  { id: 'cce', parentGroupId: null, name: 'CCE', tabOrder: 2 }
]

const REPOS = [
  { id: 'repo-pay', projectGroupId: 'perc' },
  { id: 'repo-cli', projectGroupId: 'perc-tools' },
  { id: 'repo-api', projectGroupId: 'cce' },
  { id: 'repo-suelto', projectGroupId: null }
]

const FOLDER_WORKSPACES = [
  { id: 'tasks', projectGroupId: 'perc' },
  { id: 'terminals', projectGroupId: 'cce' }
]

const OPTIONS = buildWorkspaceOptions({
  repos: REPOS,
  projectGroups: GROUPS,
  folderWorkspaces: FOLDER_WORKSPACES
})

function activeWith(filterGroupIds: string[], filterRepoIds: string[] = []) {
  return resolveActiveWorkspace({
    options: OPTIONS,
    projectGroups: GROUPS,
    filterGroupIds,
    filterRepoIds
  })
}

describe('buildWorkspaceOptions', () => {
  it('lists root groups in sidebar order and counts their whole subtree', () => {
    expect(OPTIONS.map((option) => (option.kind === 'group' ? option.name : 'ungrouped'))).toEqual([
      'Perc',
      'CCE',
      'ungrouped'
    ])
    // Perc counts repo-cli, which hangs off a subgroup.
    expect(OPTIONS[0]).toMatchObject({ repoCount: 2, workspaceCount: 1 })
  })

  it('offers the ungrouped projects as their own option', () => {
    expect(OPTIONS.at(-1)).toMatchObject({ kind: 'ungrouped', repoCount: 1 })
  })

  it('omits the ungrouped option when every project has a group', () => {
    const options = buildWorkspaceOptions({
      repos: REPOS.filter((repo) => repo.projectGroupId),
      projectGroups: GROUPS,
      folderWorkspaces: FOLDER_WORKSPACES
    })
    expect(options.some((option) => option.kind === 'ungrouped')).toBe(false)
  })
})

describe('resolveActiveWorkspace', () => {
  it('reads the workspace back out of the window filter', () => {
    const active = activeWith(['perc'])
    expect(active.option).toMatchObject({ kind: 'group', id: 'perc' })
    expect(active.narrowed).toBe(false)
  })

  it('reports a subgroup pick as the root workspace, narrowed', () => {
    const active = activeWith(['perc-tools'])
    expect(active.option).toMatchObject({ id: 'perc' })
    expect(active.narrowed).toBe(true)
  })

  // Why: an empty filter is "never chosen", which is what the seed looks for — not "show all".
  it('selects nothing when the filter is empty', () => {
    expect(activeWith([])).toEqual({ option: null, narrowed: false, custom: false })
  })

  it('recognises the ungrouped projects as a workspace', () => {
    expect(activeWith([], ['repo-suelto']).option).toMatchObject({ kind: 'ungrouped' })
  })

  it('calls a multi-group pick custom rather than claiming one workspace', () => {
    expect(activeWith(['perc', 'cce'])).toMatchObject({ option: null, custom: true })
  })
})

describe('workspaceSelectionFilter', () => {
  it('writes a group workspace as the single group pick', () => {
    expect(workspaceSelectionFilter(OPTIONS[0])).toEqual({
      filterGroupIds: ['perc'],
      filterRepoIds: []
    })
  })

  it('writes the ungrouped workspace as its project picks, which no group can name', () => {
    expect(workspaceSelectionFilter(OPTIONS[2])).toEqual({
      filterGroupIds: [],
      filterRepoIds: ['repo-suelto']
    })
  })

  it('round-trips through resolveActiveWorkspace for every option', () => {
    for (const option of OPTIONS) {
      const filter = workspaceSelectionFilter(option)
      expect(activeWith(filter.filterGroupIds, filter.filterRepoIds).option).toEqual(option)
    }
  })
})

describe('rootGroupIdOf', () => {
  it('walks a subgroup up to its root', () => {
    expect(rootGroupIdOf(GROUPS, 'perc-tools')).toBe('perc')
    expect(rootGroupIdOf(GROUPS, 'perc')).toBe('perc')
  })

  it('is null for an unknown group', () => {
    expect(rootGroupIdOf(GROUPS, 'fantasma')).toBeNull()
  })

  it('stops on a cycle instead of hanging', () => {
    const cyclic = [
      { id: 'a', parentGroupId: 'b' },
      { id: 'b', parentGroupId: 'a' }
    ]
    expect(rootGroupIdOf(cyclic, 'a')).toBe('a')
  })
})

describe('resolveWorkspaceForActiveWorkspaceKey', () => {
  const seed = (activeWorkspaceKey: string | null) =>
    resolveWorkspaceForActiveWorkspaceKey({
      options: OPTIONS,
      projectGroups: GROUPS,
      repos: REPOS,
      folderWorkspaces: FOLDER_WORKSPACES,
      activeWorkspaceKey
    })

  it('opens on the workspace holding the folder workspace the user was in', () => {
    expect(seed('folder:terminals')).toMatchObject({ id: 'cce' })
  })

  it('opens on the root workspace of a git worktree, subgroups included', () => {
    expect(seed('repo-cli::/wt/main')).toMatchObject({ id: 'perc' })
  })

  it('sends an ungrouped project to the ungrouped workspace', () => {
    expect(seed('repo-suelto::/wt/main')).toMatchObject({ kind: 'ungrouped' })
  })

  it('falls back to the first workspace with nothing active', () => {
    expect(seed(null)).toMatchObject({ id: 'perc' })
  })
})
