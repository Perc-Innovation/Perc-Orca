import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState, getDefaultWorkspaceSession } from '../shared/constants'
import type { FolderWorkspace, ProjectGroup, TerminalTab } from '../shared/types'
import { folderWorkspaceKey } from '../shared/workspace-scope'

const testState = { dir: '' }

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf-8'),
    decryptString: (value: Buffer) => value.toString('utf-8').replace(/^encrypted:/, '')
  }
}))

vi.mock('./ssh/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(() => []),
  sshConfigHostsToTargets: vi.fn(() => [])
}))

vi.mock('./telemetry/client', () => ({ track: vi.fn() }))
vi.mock('./telemetry/cohort-classifier', () => ({ getCohortAtEmit: vi.fn() }))

const stores: { flushOrThrow(): void }[] = []

async function createStore(dataFile = join(testState.dir, 'orca-data.json')) {
  const { Store, initDataPath } = await import('./persistence')
  initDataPath()
  const store = new Store({ dataFile })
  stores.push(store)
  return store
}

function projectGroup(overrides: Partial<ProjectGroup>): ProjectGroup {
  return {
    id: 'manual-local',
    name: 'Manual local',
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
  }
}

function folderWorkspace(overrides: Partial<FolderWorkspace>): FolderWorkspace {
  return {
    id: 'manual-local-workspace',
    projectGroupId: 'manual-local',
    name: 'Manual local workspace',
    folderPath: join(testState.dir, 'local-folder'),
    connectionId: null,
    linkedTask: null,
    linkedTaskSourceContext: null,
    comment: 'preserve me',
    isArchived: false,
    isUnread: true,
    isPinned: true,
    sortOrder: 10,
    lastActivityAt: 9,
    createdAt: 1,
    updatedAt: 2,
    ...overrides
  }
}

function terminalTab(id: string, worktreeId: string): TerminalTab {
  return {
    id,
    ptyId: null,
    worktreeId,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

describe('folder workspace persistence load', () => {
  beforeEach(() => {
    testState.dir = mkdtempSync(join(tmpdir(), 'orca-folder-workspace-load-'))
    stores.length = 0
  })

  afterEach(() => {
    for (const store of stores) {
      store.flushOrThrow()
    }
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it('round-trips a real manual-group workspace and its terminal wiring across restart', async () => {
    const folderPath = join(testState.dir, 'real-folder')
    mkdirSync(folderPath)
    const initial = await createStore()
    const group = initial.createProjectGroup({
      name: 'Manual',
      parentPath: null,
      createdFrom: 'manual'
    })
    const workspace = initial.createFolderWorkspace({
      projectGroupId: group.id,
      name: 'Manual workspace',
      folderPath,
      connectionId: null
    })
    const workspaceKey = folderWorkspaceKey(workspace.id)
    const tab = terminalTab('manual-tab', workspaceKey)
    initial.setWorkspaceSession({
      ...getDefaultWorkspaceSession(),
      activeWorkspaceKey: workspaceKey,
      activeWorktreeId: workspaceKey,
      activeTabId: tab.id,
      tabsByWorktree: { [workspaceKey]: [tab] },
      terminalLayoutsByTabId: {
        [tab.id]: { root: null, activeLeafId: null, expandedLeafId: null }
      }
    })
    initial.flushOrThrow()

    const restarted = await createStore()
    expect(restarted.getFolderWorkspaces()).toContainEqual(
      expect.objectContaining({
        id: workspace.id,
        projectGroupId: group.id,
        folderPath,
        connectionId: null
      })
    )
    expect(restarted.getWorkspaceSession().tabsByWorktree[workspaceKey]).toEqual([tab])

    restarted.flushOrThrow()
    const persisted = JSON.parse(readFileSync(join(testState.dir, 'orca-data.json'), 'utf-8')) as {
      folderWorkspaces: FolderWorkspace[]
    }
    expect(persisted.folderWorkspaces.map((entry) => entry.id)).toContain(workspace.id)

    expect(restarted.deleteProjectGroup(group.id)).toBe(true)
    restarted.flushOrThrow()
    const cleaned = await createStore()
    expect(cleaned.getFolderWorkspaces()).toEqual([])
    expect(cleaned.getWorkspaceSession().tabsByWorktree[workspaceKey]).toBeUndefined()
  })

  it('salvages valid local and SSH shapes while dropping only unresolvable records', async () => {
    const dataFile = join(testState.dir, 'legacy-orca-data.json')
    const localPath = join(testState.dir, 'manual-local-folder')
    const remotePath = '/srv/manual-ssh-folder'
    const windowsPath = 'C:\\workspace\\manual-folder'
    const groups = [
      projectGroup({ id: 'manual-local' }),
      projectGroup({ id: 'manual-ssh', name: 'Manual SSH', connectionId: 'ssh-1', tabOrder: 1 }),
      projectGroup({
        id: 'folder-scan',
        name: 'Folder scan',
        parentPath: '/srv/folder-scan',
        createdFrom: 'folder-scan',
        tabOrder: 2
      })
    ]
    const valid = [
      folderWorkspace({ id: 'manual-local-workspace', folderPath: localPath }),
      folderWorkspace({
        id: 'manual-ssh-workspace',
        projectGroupId: 'manual-ssh',
        folderPath: remotePath,
        connectionId: undefined
      }),
      folderWorkspace({ id: 'manual-windows-workspace', folderPath: windowsPath }),
      folderWorkspace({
        id: 'legacy-fallback-workspace',
        projectGroupId: 'folder-scan',
        folderPath: ''
      })
    ]
    const invalid = [
      folderWorkspace({ id: 'missing-group-workspace', projectGroupId: 'missing' }),
      folderWorkspace({ id: 'missing-path-workspace', folderPath: '' }),
      folderWorkspace({ id: 'manual-local-workspace', name: 'duplicate' }),
      { ...folderWorkspace({ id: 'invalid-project-group' }), projectGroupId: 42 },
      { ...folderWorkspace({ id: 'empty-id' }), id: '' },
      null,
      42
    ]
    const defaults = getDefaultPersistedState(testState.dir)
    writeFileSync(
      dataFile,
      JSON.stringify({
        ...defaults,
        projectGroups: groups,
        folderWorkspaces: [...valid, ...invalid]
      }),
      'utf-8'
    )

    const store = await createStore(dataFile)
    expect(store.getFolderWorkspaces()).toEqual([
      expect.objectContaining({ id: 'manual-local-workspace', folderPath: localPath }),
      expect.objectContaining({
        id: 'manual-ssh-workspace',
        folderPath: remotePath,
        connectionId: 'ssh-1'
      }),
      expect.objectContaining({ id: 'manual-windows-workspace', folderPath: windowsPath }),
      expect.objectContaining({
        id: 'legacy-fallback-workspace',
        folderPath: '/srv/folder-scan'
      })
    ])
    expect(store.getFolderWorkspaces()[0]?.connectionId).toBeNull()
  })
})
