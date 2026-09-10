// @vitest-environment happy-dom

/**
 * The switcher is the only place the sidebar says which workspace the window is in, so what it
 * renders and what it writes to the per-window filter are the contract.
 */

import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  setFilterGroupIds: vi.fn(),
  setFilterRepoIds: vi.fn(),
  openProjectGroupWindow: vi.fn(async () => ({ status: 'opened' })),
  focusWorkspaceOnSwitch: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

// The focus that follows a switch reads the live store; it has its own test.
vi.mock('./workspace-switch-focus', () => ({
  focusWorkspaceOnSwitch: mocks.focusWorkspaceOnSwitch
}))

// Radix portals its content behind a trigger click; render both inline so the items are assertable.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => <hr />,
  // A div, not a button: the item nests the open-in-window button, and a button cannot.
  DropdownMenuItem: ({
    children,
    onSelect,
    ...rest
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => (
    <div role="menuitem" onClick={onSelect} {...rest}>
      {children}
    </div>
  )
}))

import SidebarWorkspaceSelector from './SidebarWorkspaceSelector'

const GROUPS = [
  { id: 'perc', parentGroupId: null, name: 'Perc', tabOrder: 0 },
  { id: 'cce', parentGroupId: null, name: 'CCE', tabOrder: 1 }
]

function setState(overrides: Record<string, unknown> = {}): void {
  mocks.state = {
    repos: [
      { id: 'repo-pay', projectGroupId: 'perc' },
      { id: 'repo-api', projectGroupId: 'cce' },
      { id: 'repo-suelto', projectGroupId: null }
    ],
    projectGroups: GROUPS,
    folderWorkspaces: [{ id: 'tasks', projectGroupId: 'perc' }],
    filterRepoIds: [],
    filterGroupIds: ['perc'],
    setFilterRepoIds: mocks.setFilterRepoIds,
    setFilterGroupIds: mocks.setFilterGroupIds,
    scopedWindowsEnabled: true,
    openProjectGroupWindow: mocks.openProjectGroupWindow,
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root

function option(id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-workspace-option="${id}"]`)
  if (!element) {
    throw new Error(`workspace option ${id} not rendered`)
  }
  return element
}

function openWindowButton(id: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[data-workspace-open-window="${id}"]`)
}

beforeEach(() => {
  // Why: the new-window button closes the menu, a React state update act() has to own.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mocks.setFilterGroupIds.mockClear()
  mocks.setFilterRepoIds.mockClear()
  mocks.openProjectGroupWindow.mockClear()
  mocks.focusWorkspaceOnSwitch.mockClear()
  setState()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(): void {
  act(() => {
    root.render(<SidebarWorkspaceSelector />)
  })
}

describe('SidebarWorkspaceSelector', () => {
  it('names the workspace the window is in', () => {
    render()

    const trigger = container.querySelector('[data-sidebar-workspace-selector]')
    expect(trigger?.getAttribute('data-sidebar-workspace-selector')).toBe('perc')
    expect(trigger?.textContent).toContain('Perc')
  })

  it('offers every root workspace plus the ungrouped projects', () => {
    render()

    expect(option('perc').textContent).toContain('Perc')
    expect(option('cce').textContent).toContain('CCE')
    expect(option('ungrouped').textContent).toContain('No workspace')
  })

  it('lists workspaces by name alone, without project counts', () => {
    render()

    expect(option('perc').textContent).toBe('Perc')
    expect(option('ungrouped').textContent).toBe('No workspace')
  })

  it('switches the window filter to the chosen workspace and refocuses inside it', () => {
    render()

    act(() => {
      option('cce').click()
    })

    expect(mocks.setFilterGroupIds).toHaveBeenCalledWith(['cce'])
    expect(mocks.setFilterRepoIds).toHaveBeenCalledWith([])
    expect(mocks.focusWorkspaceOnSwitch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'group', id: 'cce' })
    )
  })

  it('opens the workspace in a new window without switching this one', () => {
    render()

    act(() => {
      openWindowButton('cce')?.click()
    })

    expect(mocks.openProjectGroupWindow).toHaveBeenCalledWith('cce')
    expect(mocks.setFilterGroupIds).not.toHaveBeenCalled()
    expect(mocks.focusWorkspaceOnSwitch).not.toHaveBeenCalled()
  })

  it('offers no new window for the ungrouped projects, which no window can scope to', () => {
    render()

    expect(openWindowButton('ungrouped')).toBeNull()
  })

  it('hides the new-window button when multi-window is off', () => {
    setState({ scopedWindowsEnabled: false })
    render()

    expect(openWindowButton('cce')).toBeNull()
  })

  it('switches to the ungrouped projects by naming them, since no group can', () => {
    render()

    act(() => {
      option('ungrouped').click()
    })

    expect(mocks.setFilterGroupIds).toHaveBeenCalledWith([])
    expect(mocks.setFilterRepoIds).toHaveBeenCalledWith(['repo-suelto'])
  })

  it('says the view is filtered when something narrows the workspace further', () => {
    setState({ filterGroupIds: ['perc'], filterRepoIds: ['repo-pay'] })
    render()

    expect(container.textContent).toContain('filtered')
  })

  it('renders nothing while no project exists to put in a workspace', () => {
    setState({ repos: [], projectGroups: [], folderWorkspaces: [] })
    render()

    expect(container.querySelector('[data-sidebar-workspace-selector]')).toBeNull()
  })
})
