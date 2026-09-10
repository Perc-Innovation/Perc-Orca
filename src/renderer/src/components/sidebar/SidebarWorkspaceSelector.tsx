import React, { useCallback, useState } from 'react'
import { AppWindow, Check, ChevronDown, FolderTree, Layers } from 'lucide-react'
import { useAppStore } from '@/store'
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

function stopEvent(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

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
  // Why: launch-time flag from main; with multi-window off nothing could open a second window.
  const scopedWindowsEnabled = useAppStore((s) => s.scopedWindowsEnabled)
  const openProjectGroupWindow = useAppStore((s) => s.openProjectGroupWindow)
  const [open, setOpen] = useState(false)
  const onSelect = useCallback((option: WorkspaceOption) => select(option), [select])
  const onOpenWindow = useCallback(
    (groupId: string) => {
      setOpen(false)
      void openProjectGroupWindow(groupId)
    },
    [openProjectGroupWindow]
  )

  if (options.length === 0) {
    return null
  }
  const label = active
    ? optionLabel(active)
    : custom
      ? translate('auto.components.sidebar.SidebarWorkspaceSelector.custom', 'Custom filter')
      : translate('auto.components.sidebar.SidebarWorkspaceSelector.all', 'All workspaces')

  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
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
                <span className="min-w-0 flex-1 truncate">{optionLabel(option)}</span>
                {scopedWindowsEnabled && option.kind === 'group' ? (
                  <button
                    type="button"
                    data-workspace-open-window={option.id}
                    aria-label={translate(
                      'auto.components.sidebar.SidebarWorkspaceSelector.openInNewWindow',
                      'Open {{name}} in new window',
                      { name: option.name }
                    )}
                    title={translate(
                      'auto.components.sidebar.SidebarWorkspaceSelector.openInNewWindowTitle',
                      'Open in new window'
                    )}
                    // Why all three: the Radix item synthesizes its own click on a pointerup it saw
                    // no pointerdown for, so stopping only one of them still switches the workspace.
                    onPointerDown={stopEvent}
                    onPointerUp={stopEvent}
                    onClick={(event) => {
                      stopEvent(event)
                      onOpenWindow(option.id)
                    }}
                    className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <AppWindow className="size-3.5" />
                  </button>
                ) : null}
              </DropdownMenuItem>
            </React.Fragment>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

export default SidebarWorkspaceSelector
