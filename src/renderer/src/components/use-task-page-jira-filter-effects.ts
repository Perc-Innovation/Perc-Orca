import type { TaskPageJiraListEffectsModel } from './use-task-page-jira-list-effects'
import { useEffect } from 'react'
import { jiraListSavedFilters } from '@/runtime/runtime-jira-client'
import { saveJiraFilterViewState } from './jira-custom-filters-storage'

/** Persists the custom/active Jira filter selection and keeps Jira's saved filters in sync. */
export function useTaskPageJiraFilterEffects(model: TaskPageJiraListEffectsModel) {
  const {
    settings,
    taskSource,
    jiraConnected,
    selectedJiraSiteId,
    jiraRefreshNonce,
    taskResumeApplied,
    jiraTaskSourceContext,
    jiraCustomFilters,
    activeJiraFilter,
    setActiveJiraFilter,
    setJiraSavedFilters,
    setJiraSavedFiltersLoading
  } = model

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    saveJiraFilterViewState({
      customFilters: jiraCustomFilters,
      activeFilter: activeJiraFilter ?? undefined
    })
  }, [activeJiraFilter, jiraCustomFilters, taskResumeApplied])

  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'jira' || !jiraConnected) {
      return
    }
    let cancelled = false
    setJiraSavedFiltersLoading(true)
    jiraListSavedFilters(jiraTaskSourceContext ?? settings, selectedJiraSiteId)
      .then((filters) => {
        if (cancelled) {
          return
        }
        setJiraSavedFilters(filters)
        // Reconcile the active saved filter: pick up renames/JQL edits, and fall
        // back to presets when the filter was deleted in Jira or is out of scope.
        setActiveJiraFilter((current) => {
          if (current?.source !== 'saved') {
            return current
          }
          const match = filters.find(
            (filter) => filter.siteId === current.siteId && filter.id === current.filterId
          )
          if (!match) {
            return null
          }
          return match.name !== current.name || match.jql !== current.jql
            ? { ...current, name: match.name, jql: match.jql }
            : current
        })
      })
      .catch((error) => {
        if (!cancelled) {
          // Keep the panel usable without saved filters (e.g. older remote hosts).
          setJiraSavedFilters([])
          console.warn('[jira] saved filters load failed:', error)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setJiraSavedFiltersLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    taskSource,
    jiraConnected,
    selectedJiraSiteId,
    jiraRefreshNonce,
    taskResumeApplied,
    jiraTaskSourceContext,
    settings,
    setActiveJiraFilter,
    setJiraSavedFilters,
    setJiraSavedFiltersLoading
  ])

  return model
}
export type TaskPageJiraFilterEffectsModel = ReturnType<typeof useTaskPageJiraFilterEffects>
