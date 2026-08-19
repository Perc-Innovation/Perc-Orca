import { describe, expect, it } from 'vitest'
import { normalizeFolderWorkspaces } from './folder-workspaces'
import type { ProjectGroup } from './project-group-types'

function group(overrides: Partial<ProjectGroup>): ProjectGroup {
  return {
    id: 'group-1',
    name: 'Group',
    parentPath: null,
    connectionId: null,
    parentGroupId: null,
    createdFrom: 'manual',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  } as ProjectGroup
}

function workspace(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'workspace-1',
    projectGroupId: 'group-1',
    name: 'Terminals',
    folderPath: '/tmp/project',
    connectionId: null,
    sortOrder: 10,
    lastActivityAt: 5,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  }
}

describe('normalizeFolderWorkspaces', () => {
  it('keeps a workspace with its own folderPath in a manual group without parentPath', () => {
    const groups = [group({ id: 'group-1', parentPath: null })]
    const result = normalizeFolderWorkspaces([workspace({})], groups)
    expect(result.map((entry) => entry.id)).toEqual(['workspace-1'])
    expect(result[0].folderPath).toBe('/tmp/project')
  })

  it('drops a workspace whose group does not exist', () => {
    const result = normalizeFolderWorkspaces(
      [workspace({ projectGroupId: 'missing-group' })],
      [group({ id: 'group-1' })]
    )
    expect(result).toEqual([])
  })

  it('drops a workspace with no folderPath when the group has no parentPath', () => {
    const groups = [group({ id: 'group-1', parentPath: null })]
    const result = normalizeFolderWorkspaces([workspace({ folderPath: '' })], groups)
    expect(result).toEqual([])
  })

  it('falls back to the group parentPath when the workspace has no folderPath', () => {
    const groups = [group({ id: 'group-1', parentPath: '/tmp/parent' })]
    const result = normalizeFolderWorkspaces([workspace({ folderPath: undefined })], groups)
    expect(result[0]?.folderPath).toBe('/tmp/parent')
  })

  it('preserves an explicit null connectionId instead of inheriting from the group', () => {
    const groups = [group({ id: 'group-1', parentPath: '/tmp/parent', connectionId: 'ssh-remote' })]
    const result = normalizeFolderWorkspaces([workspace({ connectionId: null })], groups)
    expect(result[0]?.connectionId).toBeNull()
  })
})
