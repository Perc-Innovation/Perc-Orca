import { useCallback, useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  buildWorkspaceOptions,
  resolveActiveWorkspace,
  workspaceSelectionFilter,
  type ActiveWorkspace,
  type WorkspaceOption
} from './workspace-selection'

export type WorkspaceSelection = ActiveWorkspace & {
  options: WorkspaceOption[]
  select: (option: WorkspaceOption) => void
}

/** The window's current workspace and the switcher's options, read off the per-window filter. */
export function useWorkspaceSelection(): WorkspaceSelection {
  const repos = useAppStore((s) => s.repos)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const filterGroupIds = useAppStore((s) => s.filterGroupIds)
  const setFilterRepoIds = useAppStore((s) => s.setFilterRepoIds)
  const setFilterGroupIds = useAppStore((s) => s.setFilterGroupIds)

  const options = useMemo(
    () => buildWorkspaceOptions({ repos, projectGroups, folderWorkspaces }),
    [repos, projectGroups, folderWorkspaces]
  )
  const active = useMemo(
    () => resolveActiveWorkspace({ options, projectGroups, filterGroupIds, filterRepoIds }),
    [options, projectGroups, filterGroupIds, filterRepoIds]
  )
  const select = useCallback(
    (option: WorkspaceOption) => {
      const next = workspaceSelectionFilter(option)
      setFilterGroupIds(next.filterGroupIds)
      setFilterRepoIds(next.filterRepoIds)
    },
    [setFilterGroupIds, setFilterRepoIds]
  )

  return { ...active, options, select }
}
