import { useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  buildProjectFilterSelection,
  type ProjectFilterSelection
} from './project-filter-selection'

export function useProjectFilterSelection(): ProjectFilterSelection {
  const repos = useAppStore((s) => s.repos)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const filterRepoIds = useAppStore((s) => s.filterRepoIds)
  const filterGroupIds = useAppStore((s) => s.filterGroupIds)
  return useMemo(
    () => buildProjectFilterSelection({ repos, projectGroups, filterRepoIds, filterGroupIds }),
    [repos, projectGroups, filterRepoIds, filterGroupIds]
  )
}
