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
  setFilterRepoIds: vi.fn()
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.state)
}))

// Radix portals its content behind a trigger click; render both inline so the items are assertable.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
    ...rest
  }: {
    children: React.ReactNode
    onSelect?: () => void
  }) => (
    <button type="button" onClick={onSelect} {...rest}>
      {children}
    </button>
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
    ...overrides
  }
}

let container: HTMLDivElement
let root: Root

function option(id: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(`[data-workspace-option="${id}"]`)
  if (!element) {
    throw new Error(`workspace option ${id} not rendered`)
  }
  return element
}

beforeEach(() => {
  mocks.setFilterGroupIds.mockClear()
  mocks.setFilterRepoIds.mockClear()
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

  it('switches the window filter to the chosen workspace', () => {
    render()

    act(() => {
      option('cce').click()
    })

    expect(mocks.setFilterGroupIds).toHaveBeenCalledWith(['cce'])
    expect(mocks.setFilterRepoIds).toHaveBeenCalledWith([])
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
