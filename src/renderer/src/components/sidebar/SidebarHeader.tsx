import React, { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import SidebarWorkspaceSelector from './SidebarWorkspaceSelector'
import { translate } from '@/i18n/i18n'
import { SidebarHeaderActions } from './sidebar-header-actions'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverArrow, PopoverContent } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Bell, FolderTree, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWindowScopeProject } from './use-window-scope-project'

type SidebarHeaderProps = {
  onWorkspaceBoardMenuOpenChange: (open: boolean) => void
  activityOptionsTarget?: React.Ref<HTMLDivElement>
}

const SidebarHeader = React.memo(function SidebarHeader({
  onWorkspaceBoardMenuOpenChange,
  activityOptionsTarget
}: SidebarHeaderProps) {
  // Subscribe this memoized header to locale changes before using translate().
  useTranslation()
  const sidebarBody = useAppStore((s) => s.sidebarBody ?? 'workspaces')
  const setSidebarBody = useAppStore((s) => s.setSidebarBody)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const agentsViewActive = sidebarBody === 'agents'
  const agentsSidebarIntroShown = useAppStore((s) => s.settings?.agentsSidebarIntroShown === true)
  const migratedFromExperimental = useAppStore(
    (s) => s.settings?.agentsSidebarMigratedFromExperimental === true
  )
  const introTitleId = useId()
  const introDescriptionId = useId()
  const scopedProject = useWindowScopeProject()
  // Existing users who opted into the former Experimental Agents view get one explanation.
  const introOpen = migratedFromExperimental && !agentsSidebarIntroShown
  const acknowledgeIntro = React.useCallback(() => {
    void updateSettings?.({ agentsSidebarIntroShown: true })
  }, [updateSettings])
  const activityLabel = translate(
    agentsViewActive ? 'dashboard.sidebar.closeActivity' : 'dashboard.sidebar.openActivity',
    agentsViewActive ? 'Turn off activity view' : 'View activity'
  )

  return (
    <div className="mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
      <div className="flex min-w-0 items-center gap-1">
        {scopedProject.scope ? (
          // Why: the window title is hidden on Windows/Linux chrome; this label is the affordance
          // that names the bound project on every platform.
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="flex min-w-0 items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground/80 select-none"
                data-sidebar-section-title="project-window"
                data-sidebar-project-window={scopedProject.scope.projectGroupId}
              >
                <FolderTree className="size-3.5 shrink-0" strokeWidth={2.25} />
                <span
                  className={scopedProject.group ? 'truncate text-foreground' : 'truncate italic'}
                >
                  {scopedProject.group?.name ??
                    translate(
                      'auto.components.sidebar.SidebarHeader.loadingProject',
                      'Loading project…'
                    )}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.sidebar.SidebarHeader.projectWindow', 'Project window')}
            </TooltipContent>
          </Tooltip>
        ) : (
          // Why the selector and not a title: the window is in one workspace at a time, so
          // naming that one (and switching it) is the useful label.
          <SidebarWorkspaceSelector />
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Popover
          open={introOpen}
          onOpenChange={(open) => {
            if (!open) {
              acknowledgeIntro()
            }
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0">
                <PopoverAnchor asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className={cn(
                      'text-muted-foreground',
                      agentsViewActive && 'bg-primary/15 text-primary hover:bg-primary/20'
                    )}
                    aria-label={activityLabel}
                    aria-pressed={agentsViewActive}
                    onClick={() => setSidebarBody?.(agentsViewActive ? 'workspaces' : 'agents')}
                  >
                    <Bell className="size-3.5" strokeWidth={2.25} />
                  </Button>
                </PopoverAnchor>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {activityLabel}
            </TooltipContent>
          </Tooltip>
          <PopoverContent
            side="bottom"
            align="center"
            sideOffset={8}
            className="w-72 rounded-xl border border-border bg-popover p-3.5 text-popover-foreground shadow-floating"
            onOpenAutoFocus={(event) => event.preventDefault()}
            aria-labelledby={introTitleId}
            aria-describedby={introDescriptionId}
          >
            <PopoverArrow />
            <div className="space-y-2.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <h3 id={introTitleId} className="text-sm font-semibold text-foreground">
                  {translate('agentsSidebarIntro.migrated.title', 'Agents are easier to find')}
                </h3>
              </div>
              <p id={introDescriptionId} className="text-xs leading-relaxed text-muted-foreground">
                {translate(
                  'agentsSidebarIntro.migrated.description',
                  'Your Agents view is now a dedicated sidebar tab. Your activity and filters are preserved.'
                )}
              </p>
              <div className="flex justify-end pt-0.5">
                <Button size="sm" onClick={acknowledgeIntro}>
                  {translate('agentsSidebarIntro.migrated.dismiss', 'Got it')}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {agentsViewActive ? (
          <div ref={activityOptionsTarget} className="flex items-center" />
        ) : null}
        <SidebarHeaderActions
          onWorkspaceBoardMenuOpenChange={onWorkspaceBoardMenuOpenChange}
          hideWorkspaceOptions={agentsViewActive}
        />
      </div>
    </div>
  )
})

export default SidebarHeader
