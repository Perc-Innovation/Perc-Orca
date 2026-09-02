import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import {
  buildWorkspaceOptions,
  resolveWorkspaceForActiveWorkspaceKey,
  workspaceSelectionFilter
} from './workspace-selection'

/**
 * Seeds the window's workspace the first time it has none, once the catalog is up.
 *
 * The sidebar shows one workspace at a time, so an empty filter is "never chosen" rather than
 * "show everything" — but only for the *first* choice: the ref makes this fire once per window, so
 * a user who switches away is never dragged back, and a project window (which derives its filter
 * from its scope) is skipped outright.
 */
export function useInitialWorkspaceSelection(): void {
  const seeded = useRef(false)
  const windowScope = useAppStore((s) => s.windowScope)
  const repos = useAppStore((s) => s.repos)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const folderWorkspaces = useAppStore((s) => s.folderWorkspaces)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const filterGroupIds = useAppStore((s) => s.filterGroupIds)
  const activeWorkspaceKey = useAppStore((s) => s.activeWorkspaceKey)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const setFilterRepoIds = useAppStore((s) => s.setFilterRepoIds)
  const setFilterGroupIds = useAppStore((s) => s.setFilterGroupIds)

  useEffect(() => {
    if (
      seeded.current ||
      windowScope ||
      filterGroupIds.length > 0 ||
      filterRepoIds.length > 0 ||
      projectGroups.length === 0
    ) {
      return
    }
    const options = buildWorkspaceOptions({ repos, projectGroups, folderWorkspaces })
    const option = resolveWorkspaceForActiveWorkspaceKey({
      options,
      projectGroups,
      repos,
      folderWorkspaces,
      activeWorkspaceKey: activeWorkspaceKey ?? activeWorktreeId
    })
    if (!option) {
      return
    }
    seeded.current = true
    const next = workspaceSelectionFilter(option)
    setFilterGroupIds(next.filterGroupIds)
    setFilterRepoIds(next.filterRepoIds)
  }, [
    windowScope,
    repos,
    projectGroups,
    folderWorkspaces,
    filterRepoIds,
    filterGroupIds,
    activeWorkspaceKey,
    activeWorktreeId,
    setFilterRepoIds,
    setFilterGroupIds
  ])
}
