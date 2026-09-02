import type { TaskPageJiraListProjectionModel } from './use-task-page-jira-list-projection'
import { useCallback, useMemo } from 'react'
import type { JiraIssue } from '../../../shared/jira-types'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  buildJiraIssueWorkspaceAttachmentIndex,
  findJiraIssueWorkspaceAttachmentInIndex
} from '@/lib/jira-issue-workspace-attachment'
import { jiraUpdateIssue } from '@/runtime/runtime-jira-client'
import type { TaskPageJiraBoardSection } from '@/components/task-page-jira-board-sections'
import { jiraBoardIssueRefKey } from '@/components/task-page-jira-board'
import {
  findJiraBoardSectionTransition,
  loadTaskPageJiraIssueTransitions
} from '@/components/task-page-jira-board-transitions'

/** Kanban moves (status transitions) and the issue → workspace attachment lookup. */
export function useTaskPageJiraBoard(model: TaskPageJiraListProjectionModel) {
  const {
    settings,
    jiraTaskSourceContext,
    jiraTaskSourceScopeKey,
    linearAttachmentWorkspaces,
    jiraBoardUpdatingIssueKeys,
    setJiraBoardUpdatingIssueKeys
  } = model
  const patchJiraIssue = useAppStore((s) => s.patchJiraIssue)

  const jiraIssueAttachmentIndex = useMemo(
    () => buildJiraIssueWorkspaceAttachmentIndex(linearAttachmentWorkspaces),
    [linearAttachmentWorkspaces]
  )
  const getJiraIssueAttachedWorkspace = useCallback(
    (issue: JiraIssue) => findJiraIssueWorkspaceAttachmentInIndex(jiraIssueAttachmentIndex, issue),
    [jiraIssueAttachmentIndex]
  )

  const handleJiraBoardMoveIssue = useCallback(
    async (issue: JiraIssue, section: TaskPageJiraBoardSection): Promise<void> => {
      const refKey = jiraBoardIssueRefKey(issue)
      if (jiraBoardUpdatingIssueKeys.has(refKey)) {
        return
      }
      setJiraBoardUpdatingIssueKeys((prev) => {
        const next = new Set(prev)
        next.add(refKey)
        return next
      })

      const previousStatus = issue.status
      const providerSettings = jiraTaskSourceContext ?? settings
      const revert = (): void =>
        patchJiraIssue(
          issue.key,
          { status: previousStatus },
          { sourceContext: jiraTaskSourceContext }
        )
      try {
        const transitions = await loadTaskPageJiraIssueTransitions(
          providerSettings,
          jiraTaskSourceScopeKey,
          issue
        )
        const transition = findJiraBoardSectionTransition(transitions, section)
        if (!transition) {
          toast.error(
            translate(
              'auto.components.TaskPage.jiraBoardNoTransition',
              'No Jira transition to "{{value0}}" is available for {{value1}}',
              { value0: section.label, value1: issue.key }
            )
          )
          return
        }

        patchJiraIssue(
          issue.key,
          { status: transition.to },
          { sourceContext: jiraTaskSourceContext }
        )
        const result = await jiraUpdateIssue(
          providerSettings,
          issue.key,
          { transitionId: transition.id },
          issue.siteId
        )
        if (result.ok === false) {
          revert()
          toast.error(
            result.error ??
              translate('auto.components.TaskPage.jiraBoardMoveFailed', 'Failed to move Jira issue')
          )
          return
        }
        useAppStore.getState().recordFeatureInteraction('jira-tasks')
      } catch {
        revert()
        toast.error(
          translate('auto.components.TaskPage.jiraBoardMoveFailed', 'Failed to move Jira issue')
        )
      } finally {
        setJiraBoardUpdatingIssueKeys((prev) => {
          const next = new Set(prev)
          next.delete(refKey)
          return next
        })
      }
    },
    [
      jiraBoardUpdatingIssueKeys,
      jiraTaskSourceContext,
      jiraTaskSourceScopeKey,
      patchJiraIssue,
      setJiraBoardUpdatingIssueKeys,
      settings
    ]
  )

  const nextModel = model as typeof model & {
    getJiraIssueAttachedWorkspace: typeof getJiraIssueAttachedWorkspace
    handleJiraBoardMoveIssue: typeof handleJiraBoardMoveIssue
  }
  nextModel.getJiraIssueAttachedWorkspace = getJiraIssueAttachedWorkspace
  nextModel.handleJiraBoardMoveIssue = handleJiraBoardMoveIssue
  return nextModel
}
export type TaskPageJiraBoardModel = ReturnType<typeof useTaskPageJiraBoard>
