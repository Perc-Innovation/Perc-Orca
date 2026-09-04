import type { TaskPageJiraListStateModel } from './use-task-page-jira-list-state'
import { useCallback, useState } from 'react'
import type { JiraSavedFilter } from '../../../shared/jira-types'
import {
  MAX_JIRA_CUSTOM_FILTERS,
  type ActiveJiraFilterRef,
  type JiraCustomFilter
} from '../../../shared/jira-custom-filters'
import type { JiraViewMode } from '@/components/task-page-localized-options'

/** Jira view mode, board move bookkeeping, and the saved/custom filter selection. */
export function useTaskPageJiraFilterState(model: TaskPageJiraListStateModel) {
  const { setTaskResumeState, setJiraSearchInput, setAppliedJiraSearch } = model
  const [jiraViewMode, setJiraViewMode] = useState<JiraViewMode>('list')
  const [jiraBoardUpdatingIssueKeys, setJiraBoardUpdatingIssueKeys] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [jiraSavedFilters, setJiraSavedFilters] = useState<JiraSavedFilter[]>([])
  const [jiraSavedFiltersLoading, setJiraSavedFiltersLoading] = useState(false)
  const [jiraCustomFilters, setJiraCustomFilters] = useState<JiraCustomFilter[]>([])
  const [activeJiraFilter, setActiveJiraFilter] = useState<ActiveJiraFilterRef | null>(null)

  const handleSelectJiraSavedFilter = useCallback(
    (filter: JiraSavedFilter) => {
      setJiraSearchInput('')
      setAppliedJiraSearch('')
      // Snapshot name/jql so the filter can run before the next list refresh.
      setActiveJiraFilter({
        source: 'saved',
        siteId: filter.siteId,
        filterId: filter.id,
        name: filter.name,
        jql: filter.jql
      })
      setTaskResumeState({ jiraQuery: '' })
    },
    [setAppliedJiraSearch, setJiraSearchInput, setTaskResumeState]
  )

  const handleSelectJiraCustomFilter = useCallback(
    (filter: JiraCustomFilter) => {
      setJiraSearchInput('')
      setAppliedJiraSearch('')
      setActiveJiraFilter({ source: 'custom', id: filter.id })
      setTaskResumeState({ jiraQuery: '' })
    },
    [setAppliedJiraSearch, setJiraSearchInput, setTaskResumeState]
  )

  const handleCreateJiraCustomFilter = useCallback(
    (draft: { name: string; jql: string }) => {
      if (jiraCustomFilters.length >= MAX_JIRA_CUSTOM_FILTERS) {
        return
      }
      const id = crypto.randomUUID()
      setJiraCustomFilters((current) => [...current, { id, ...draft }])
      setJiraSearchInput('')
      setAppliedJiraSearch('')
      setActiveJiraFilter({ source: 'custom', id })
      setTaskResumeState({ jiraQuery: '' })
    },
    [jiraCustomFilters.length, setAppliedJiraSearch, setJiraSearchInput, setTaskResumeState]
  )

  const handleUpdateJiraCustomFilter = useCallback(
    (id: string, draft: { name: string; jql: string }) => {
      setJiraCustomFilters((current) =>
        current.map((filter) => (filter.id === id ? { ...filter, ...draft } : filter))
      )
    },
    []
  )

  const handleDeleteJiraCustomFilter = useCallback((id: string) => {
    setJiraCustomFilters((current) => current.filter((filter) => filter.id !== id))
    setActiveJiraFilter((current) =>
      current?.source === 'custom' && current.id === id ? null : current
    )
  }, [])

  const nextModel = model as typeof model & {
    jiraViewMode: typeof jiraViewMode
    setJiraViewMode: typeof setJiraViewMode
    jiraBoardUpdatingIssueKeys: typeof jiraBoardUpdatingIssueKeys
    setJiraBoardUpdatingIssueKeys: typeof setJiraBoardUpdatingIssueKeys
    jiraSavedFilters: typeof jiraSavedFilters
    setJiraSavedFilters: typeof setJiraSavedFilters
    jiraSavedFiltersLoading: typeof jiraSavedFiltersLoading
    setJiraSavedFiltersLoading: typeof setJiraSavedFiltersLoading
    jiraCustomFilters: typeof jiraCustomFilters
    setJiraCustomFilters: typeof setJiraCustomFilters
    activeJiraFilter: typeof activeJiraFilter
    setActiveJiraFilter: typeof setActiveJiraFilter
    handleSelectJiraSavedFilter: typeof handleSelectJiraSavedFilter
    handleSelectJiraCustomFilter: typeof handleSelectJiraCustomFilter
    handleCreateJiraCustomFilter: typeof handleCreateJiraCustomFilter
    handleUpdateJiraCustomFilter: typeof handleUpdateJiraCustomFilter
    handleDeleteJiraCustomFilter: typeof handleDeleteJiraCustomFilter
  }
  nextModel.jiraViewMode = jiraViewMode
  nextModel.setJiraViewMode = setJiraViewMode
  nextModel.jiraBoardUpdatingIssueKeys = jiraBoardUpdatingIssueKeys
  nextModel.setJiraBoardUpdatingIssueKeys = setJiraBoardUpdatingIssueKeys
  nextModel.jiraSavedFilters = jiraSavedFilters
  nextModel.setJiraSavedFilters = setJiraSavedFilters
  nextModel.jiraSavedFiltersLoading = jiraSavedFiltersLoading
  nextModel.setJiraSavedFiltersLoading = setJiraSavedFiltersLoading
  nextModel.jiraCustomFilters = jiraCustomFilters
  nextModel.setJiraCustomFilters = setJiraCustomFilters
  nextModel.activeJiraFilter = activeJiraFilter
  nextModel.setActiveJiraFilter = setActiveJiraFilter
  nextModel.handleSelectJiraSavedFilter = handleSelectJiraSavedFilter
  nextModel.handleSelectJiraCustomFilter = handleSelectJiraCustomFilter
  nextModel.handleCreateJiraCustomFilter = handleCreateJiraCustomFilter
  nextModel.handleUpdateJiraCustomFilter = handleUpdateJiraCustomFilter
  nextModel.handleDeleteJiraCustomFilter = handleDeleteJiraCustomFilter
  return nextModel
}
export type TaskPageJiraFilterStateModel = ReturnType<typeof useTaskPageJiraFilterState>
