// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectGroup } from '../../../../shared/project-group-types'

const storeMocks = vi.hoisted(() => ({
  state: {
    sshTargetLabels: new Map<string, string>(),
    sshConnectionStates: new Map<string, { status: string }>(),
    createFolderWorkspace: vi.fn(),
    fetchFolderWorkspacePathStatus: vi.fn()
  }
}))

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof storeMocks.state) => unknown) => selector(storeMocks.state),
    { getState: () => storeMocks.state }
  )
}))

import { FolderWorkspaceHostDialog } from './FolderWorkspaceHostDialog'

function makeGroup(overrides: Partial<ProjectGroup> = {}): ProjectGroup {
  return {
    id: 'group-1',
    name: 'CCE',
    parentPath: '/Users/me/workspace/CCE',
    connectionId: null,
    parentGroupId: null,
    createdFrom: 'folder-scan',
    tabOrder: 0,
    isCollapsed: false,
    color: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

beforeEach(() => {
  storeMocks.state.sshTargetLabels = new Map([['ssh-raspi', 'evaleiras@raspi']])
  storeMocks.state.sshConnectionStates = new Map([['ssh-raspi', { status: 'connected' }]])
  storeMocks.state.createFolderWorkspace = vi.fn().mockResolvedValue({ id: 'fw-1' })
  storeMocks.state.fetchFolderWorkspacePathStatus = vi
    .fn()
    .mockImplementation(async (request: { path: string }) => ({
      path: request.path,
      exists: true
    }))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FolderWorkspaceHostDialog', () => {
  it('seeds from the group and probes the path with its explicit SSH connection', async () => {
    render(
      <FolderWorkspaceHostDialog
        open
        projectGroup={makeGroup({ connectionId: 'ssh-raspi', parentPath: '/home/me/em' })}
        onOpenChange={vi.fn()}
      />
    )
    await waitFor(
      () => {
        expect(storeMocks.state.fetchFolderWorkspacePathStatus).toHaveBeenCalledWith(
          { scope: 'path', path: '/home/me/em', connectionId: 'ssh-raspi' },
          { force: true }
        )
      },
      { timeout: 2_000 }
    )
  })

  it('defaults the name to Terminals so create needs no typing', async () => {
    const onOpenChange = vi.fn()
    render(
      <FolderWorkspaceHostDialog open projectGroup={makeGroup()} onOpenChange={onOpenChange} />
    )
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Terminals')
    const submit = screen.getByRole('button', { name: 'Create workspace' })
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false), {
      timeout: 2_000
    })
    await userEvent.click(submit)
    await waitFor(() => {
      expect(storeMocks.state.createFolderWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Terminals' })
      )
    })
  })

  it('creates with an explicit local pin and closes on success', async () => {
    const onOpenChange = vi.fn()
    render(
      <FolderWorkspaceHostDialog open projectGroup={makeGroup()} onOpenChange={onOpenChange} />
    )
    await userEvent.clear(screen.getByLabelText('Name'))
    await userEvent.type(screen.getByLabelText('Name'), 'Mac terminal')
    const submit = screen.getByRole('button', { name: 'Create workspace' })
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false), {
      timeout: 2_000
    })
    await userEvent.click(submit)
    await waitFor(() => {
      expect(storeMocks.state.createFolderWorkspace).toHaveBeenCalledWith({
        projectGroupId: 'group-1',
        name: 'Mac terminal',
        folderPath: '/Users/me/workspace/CCE',
        connectionId: null
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('blocks create while the folder is missing on the chosen host', async () => {
    storeMocks.state.fetchFolderWorkspacePathStatus = vi
      .fn()
      .mockImplementation(async (request: { path: string }) => ({
        path: request.path,
        exists: false,
        reason: 'missing'
      }))
    render(<FolderWorkspaceHostDialog open projectGroup={makeGroup()} onOpenChange={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Folder not found')).toBeTruthy(), {
      timeout: 2_000
    })
    expect(
      (screen.getByRole('button', { name: 'Create workspace' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('hints to connect when the seeded SSH host is disconnected', () => {
    storeMocks.state.sshConnectionStates = new Map()
    render(
      <FolderWorkspaceHostDialog
        open
        projectGroup={makeGroup({ connectionId: 'ssh-raspi', parentPath: '/home/me/em' })}
        onOpenChange={vi.fn()}
      />
    )
    expect(
      screen.getByText('Connect this host to verify the folder and create the workspace.')
    ).toBeTruthy()
  })
})
