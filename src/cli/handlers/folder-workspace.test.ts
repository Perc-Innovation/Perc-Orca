import { afterEach, describe, expect, it, vi } from 'vitest'

import { FOLDER_WORKSPACE_HANDLERS } from './folder-workspace'
import type { HandlerContext } from '../dispatch'
import type { RuntimeClient } from '../runtime-client'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'

const GROUPS = [
  { id: 'group-cce', name: 'CCE', connectionId: null },
  { id: 'group-em', name: 'Exchange Monitor', connectionId: 'ssh-raspi' },
  { id: 'group-dup-a', name: 'Dup', connectionId: null },
  { id: 'group-dup-b', name: 'Dup', connectionId: null }
] as unknown as ProjectGroup[]

const WORKSPACE = {
  id: 'fw-1',
  projectGroupId: 'group-cce',
  name: 'Raspi terminal',
  folderPath: '/home/me/workspace/CCE',
  connectionId: 'ssh-raspi'
} as unknown as FolderWorkspace

function makeContext(args: {
  flags?: Record<string, string | boolean>
  responses?: Record<string, unknown>
}): { ctx: HandlerContext; calls: { method: string; params: unknown }[] } {
  const calls: { method: string; params: unknown }[] = []
  const responses: Record<string, unknown> = {
    'projectGroup.list': { groups: GROUPS },
    'folderWorkspace.create': { folderWorkspace: WORKSPACE },
    'folderWorkspace.list': { folderWorkspaces: [WORKSPACE] },
    ...args.responses
  }
  const client = {
    isRemote: false,
    call: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params })
      if (!(method in responses)) {
        throw new Error(`Unexpected RPC method: ${method}`)
      }
      return { id: 'req', ok: true, result: responses[method] }
    })
  } as unknown as RuntimeClient
  const ctx: HandlerContext = {
    flags: new Map(Object.entries(args.flags ?? {})),
    client,
    cwd: '/current/dir',
    json: true
  }
  return { ctx, calls }
}

function createParams(calls: { method: string; params: unknown }[]): Record<string, unknown> {
  const call = calls.find((entry) => entry.method === 'folderWorkspace.create')
  if (!call) {
    throw new Error('folderWorkspace.create was not called')
  }
  return call.params as Record<string, unknown>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('folder-workspace create', () => {
  it('resolves the group by exact name and passes an explicit SSH connection', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { ctx, calls } = makeContext({
      flags: { group: 'cce', name: 'Raspi terminal', host: 'ssh:ssh-raspi', path: '/home/me/CCE' }
    })
    await FOLDER_WORKSPACE_HANDLERS['folder-workspace create'](ctx)
    expect(createParams(calls)).toEqual({
      projectGroupId: 'group-cce',
      name: 'Raspi terminal',
      folderPath: '/home/me/CCE',
      connectionId: 'ssh-raspi'
    })
  })

  it('maps --host local to an explicit null connection', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { ctx, calls } = makeContext({
      flags: { group: 'Exchange Monitor', name: 'Mac terminal', host: 'local' }
    })
    await FOLDER_WORKSPACE_HANDLERS['folder-workspace create'](ctx)
    expect(createParams(calls)).toEqual({
      projectGroupId: 'group-em',
      name: 'Mac terminal',
      connectionId: null
    })
  })

  it('omits connectionId entirely when --host is not passed', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { ctx, calls } = makeContext({ flags: { group: 'group-cce', name: 'Terminal' } })
    await FOLDER_WORKSPACE_HANDLERS['folder-workspace create'](ctx)
    expect(createParams(calls)).toEqual({ projectGroupId: 'group-cce', name: 'Terminal' })
  })

  it('rejects a relative --path when the effective host is SSH', async () => {
    const { ctx } = makeContext({
      // Why: no --host, but the group's own connection makes the target remote.
      flags: { group: 'Exchange Monitor', name: 'Terminal', path: 'relative/dir' }
    })
    await expect(FOLDER_WORKSPACE_HANDLERS['folder-workspace create'](ctx)).rejects.toThrow(
      /absolute path/
    )
  })

  it('rejects an ambiguous group name listing the candidate ids', async () => {
    const { ctx } = makeContext({ flags: { group: 'Dup', name: 'Terminal' } })
    await expect(FOLDER_WORKSPACE_HANDLERS['folder-workspace create'](ctx)).rejects.toThrow(
      /group-dup-a.*group-dup-b/
    )
  })

  it('rejects an unknown group listing the known names', async () => {
    const { ctx } = makeContext({ flags: { group: 'Nope', name: 'Terminal' } })
    await expect(FOLDER_WORKSPACE_HANDLERS['folder-workspace create'](ctx)).rejects.toThrow(
      /Known groups: CCE/
    )
  })
})

describe('folder-workspace list', () => {
  it('filters by group when --group is passed', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const other = { ...WORKSPACE, id: 'fw-2', projectGroupId: 'group-em' }
    const { ctx } = makeContext({
      flags: { group: 'CCE' },
      responses: { 'folderWorkspace.list': { folderWorkspaces: [WORKSPACE, other] } }
    })
    await FOLDER_WORKSPACE_HANDLERS['folder-workspace list'](ctx)
    const printed = log.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('fw-1')
    expect(printed).not.toContain('fw-2')
  })
})
