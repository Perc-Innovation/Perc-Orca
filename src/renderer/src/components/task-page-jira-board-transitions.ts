import type { JiraIssue, JiraTransition } from '../../../shared/types'
import { jiraListTransitions, type RuntimeJiraSettings } from '@/runtime/runtime-jira-client'
import { createMetadataRequestStore, loadMetadata } from '@/hooks/metadata-request-cache'
import type { TaskPageJiraIssueSection } from './task-page-jira-issue-list'

const jiraIssueTransitionsStore = createMetadataRequestStore<JiraTransition[]>()

export function loadTaskPageJiraIssueTransitions(
  settings: RuntimeJiraSettings,
  runtimeScopeKey: string,
  issue: Pick<JiraIssue, 'key' | 'siteId' | 'status'>
): Promise<JiraTransition[]> {
  // Why: the current status participates in the key so a moved issue naturally
  // misses the stale entry instead of reusing transitions from its old status.
  const cacheKey = [
    encodeURIComponent(runtimeScopeKey),
    encodeURIComponent(issue.siteId ?? ''),
    encodeURIComponent(issue.key),
    encodeURIComponent(issue.status.id)
  ].join(':')
  return loadMetadata(jiraIssueTransitionsStore, cacheKey, () =>
    jiraListTransitions(settings, issue.key, issue.siteId)
  ).catch((error: unknown) => {
    console.warn('[jira] Failed to load issue transitions:', error)
    return []
  })
}

export function findJiraBoardSectionTransition(
  transitions: readonly JiraTransition[],
  section: Pick<TaskPageJiraIssueSection, 'label' | 'issues'>
): JiraTransition | null {
  // Why: sections group by status name, but ids are authoritative when the
  // section already holds issues; the name match covers empty-metadata cases.
  const sectionStatusIds = new Set(section.issues.map((issue) => issue.status.id))
  return (
    transitions.find((transition) => sectionStatusIds.has(transition.to.id)) ??
    transitions.find((transition) => transition.to.name === section.label) ??
    null
  )
}
