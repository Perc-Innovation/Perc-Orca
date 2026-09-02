import React, { useCallback } from 'react'
import { Check, ChevronDown, FolderTree, Layers } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useWorkspaceSelection } from './use-workspace-selection'
import type { WorkspaceOption } from './workspace-selection'

const UNGROUPED_LABEL = () =>
  translate('auto.components.sidebar.SidebarWorkspaceSelector.ungrouped', 'No workspace')

function optionLabel(option: WorkspaceOption): string {
  return option.kind === 'group' ? option.name : UNGROUPED_LABEL()
}

/**
 * Names the workspace this window is in, and switches it. One at a time: the sidebar's job is to
 * show the project you are working in, not all seven at once.
 *
 * Only rendered in a free window — a project window is already in exactly one workspace and
 * changes it through its own menu, which also moves the session.
 */
const SidebarWorkspaceSelector = React.memo(function SidebarWorkspaceSelector() {
  const { options, option: active, narrowed, custom, select } = useWorkspaceSelection()
  const onSelect = useCallback((option: WorkspaceOption) => select(option), [select])

  if (options.length === 0) {
    return null
  }
  const label = active
    ? optionLabel(active)
    : custom
      ? translate('auto.components.sidebar.SidebarWorkspaceSelector.custom', 'Custom filter')
      : translate('auto.components.sidebar.SidebarWorkspaceSelector.all', 'All workspaces')

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 items-center gap-1.5 rounded-[5px] pl-2 pr-1 py-0.5 text-xs font-semibold text-muted-foreground/80 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={translate(
            'auto.components.sidebar.SidebarWorkspaceSelector.switch',
            'Switch workspace'
          )}
          data-sidebar-workspace-selector={active?.id ?? (active ? 'ungrouped' : 'none')}
        >
          {active?.kind === 'ungrouped' ? (
            <Layers className="size-3.5 shrink-0" strokeWidth={2.25} />
          ) : (
            <FolderTree className="size-3.5 shrink-0" strokeWidth={2.25} />
          )}
          <span className="truncate text-foreground">{label}</span>
          {narrowed && (
            // Why: a subgroup or extra project picks are still on top; without this the label
            // would claim the window shows the whole workspace when it does not.
            <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
              {translate('auto.components.sidebar.SidebarWorkspaceSelector.filtered', 'filtered')}
            </span>
          )}
          <ChevronDown className="size-3 shrink-0 opacity-60" strokeWidth={2.25} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6} className="w-60">
        {options.map((option, index) => {
          const isActive =
            active !== null &&
            active.kind === option.kind &&
            (option.kind === 'group' ? active.id === option.id : true)
          return (
            <React.Fragment key={option.kind === 'group' ? option.id : 'ungrouped'}>
              {/* Why the separator: ungrouped projects are the absence of a workspace, not one more. */}
              {option.kind === 'ungrouped' && index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                data-workspace-option={option.id ?? 'ungrouped'}
                onSelect={() => onSelect(option)}
              >
                {isActive ? (
                  <Check className="size-3.5 shrink-0" />
                ) : (
                  <span className="size-3.5 shrink-0" />
                )}
                <span className="min-w-0 truncate">{optionLabel(option)}</span>
                <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                  {option.kind === 'group' && option.workspaceCount > 0
                    ? `${option.repoCount} · ${option.workspaceCount}`
                    : option.repoCount}
                </span>
              </DropdownMenuItem>
            </React.Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

export default SidebarWorkspaceSelector
