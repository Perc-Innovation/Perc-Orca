import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  buildWorkspaceOptions,
  resolveActiveWorkspace,
  workspaceSelectionFilter,
  type ActiveWorkspace,
  type WorkspaceOption
} from './workspace-selection'
import { focusWorkspaceOnSwitch } from './workspace-switch-focus'

export type WorkspaceSelection = ActiveWorkspace & {
  options: WorkspaceOption[]
  select: (option: WorkspaceOption) => void
}

/** The window's current workspace and the switcher's options, read off the per-window filter. */
export function useWorkspaceSelection(): WorkspaceSelection {
  const repos = useAppStore((s) => s.repos)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const filterGroupIds = useAppStore((s) => s.filterGroupIds)
  const setFilterRepoIds = useAppStore((s) => s.setFilterRepoIds)
  const setFilterGroupIds = useAppStore((s) => s.setFilterGroupIds)

  const options = useMemo(
    () => buildWorkspaceOptions({ repos, projectGroups }),
    [repos, projectGroups]
  )
  const active = useMemo(
    () =>
      resolveActiveWorkspace({
        options,
        projectGroups,
        filterGroupIds,
        filterRepoIds
      }),
    [options, projectGroups, filterGroupIds, filterRepoIds]
  )
  const select = useCallback(
    (option: WorkspaceOption) => {
      const next = workspaceSelectionFilter(option)
      setFilterGroupIds(next.filterGroupIds)
      setFilterRepoIds(next.filterRepoIds)
      // Why after the filter: the activation reveals its sidebar row, which has to be listed first.
      focusWorkspaceOnSwitch(option)
    },
    [setFilterGroupIds, setFilterRepoIds]
  )

  return { ...active, options, select }
}
