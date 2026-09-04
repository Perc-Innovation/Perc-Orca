import {
  getPresentStringFlag,
  getOptionalStartupAgent,
  getOptionalSetupDecision
} from './worktree-create-flag-readers'
import type {
  RuntimeWorktreeListResult,
  RuntimeWorktreePsResult,
  RuntimeWorktreeRecord,
  RuntimeWorktreeCreateResult,
  RuntimeWorktreeRemoveResult
} from '../../shared/runtime-types'
import type { CommandHandler } from '../dispatch'
import { formatWorktreeList, formatWorktreePs, formatWorktreeShow, printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'
import { getAttachedReviewsUpdate } from './worktree-attached-reviews'
import { getTrackedBranchesUpdate } from './worktree-tracked-branches'
import {
  getOptionalNullableNumberFlag,
  getOptionalNumberFlag,
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import {
  getOptionalWorktreeSelector,
  getRequiredWorktreeSelector,
  resolveCurrentWorktreeSelector
} from '../selectors'
import { isWorkspaceKey, worktreeWorkspaceKey } from '../../shared/workspace-scope'
import { printLineageSummary } from './worktree-lineage-summary'
import {
  assertWorkspaceTargetFlagsCompatible,
  hasWorkspaceProjectTarget,
  resolveProjectCreateRepoSelector
} from '../worktree-project-target'
import {
  assertCreateParentFlagsCompatible,
  resolveCreateParentSelector
} from './worktree-create-parent-selector'
import { getOptionalLinearIssueLinkFlag } from './worktree-linear-issue-link'
import { getOptionalJiraIssueLinkFlag, resolveJiraWorkItem } from './worktree-jira-issue-link'

type HookWarningResult = {
  warning?: string
}

type PreservedBranchResult = {
  preservedBranch?: {
    branchName: string
  }
}

function printHookWarning(result: HookWarningResult, json: boolean): void {
  if (!json && result.warning) {
    console.error(`warning: ${result.warning}`)
  }
}

function printPreservedBranchWarning(result: PreservedBranchResult, json: boolean): void {
  if (!json && result.preservedBranch) {
    console.error(
      `warning: local branch "${result.preservedBranch.branchName}" was kept because Git could not safely delete it`
    )
  }
}

function assertParentWorktreeFlagsCompatible(flags: Map<string, string | boolean>): void {
  if (flags.has('parent-worktree') && flags.get('no-parent') === true) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Choose either --parent-worktree or --no-parent, not both.'
    )
  }
  const parentWorktree = flags.get('parent-worktree')
  if (
    flags.has('parent-worktree') &&
    (typeof parentWorktree !== 'string' || parentWorktree === '')
  ) {
    throw new RuntimeClientError('invalid_argument', 'Missing required --parent-worktree')
  }
}

function getEnvParentWorkspace(): string | undefined {
  const workspaceId = process.env.ORCA_WORKSPACE_ID
  if (typeof workspaceId === 'string' && isWorkspaceKey(workspaceId)) {
    return workspaceId
  }
  const worktreeId = process.env.ORCA_WORKTREE_ID
  if (typeof worktreeId === 'string' && worktreeId.length > 0) {
    return isWorkspaceKey(worktreeId) ? worktreeId : worktreeWorkspaceKey(worktreeId)
  }
  return undefined
}

function getRepoSelectorFromWorktreeSelector(selector: string | undefined): string | undefined {
  if (!selector?.startsWith('id:')) {
    return undefined
  }
  const worktreeId = selector.slice('id:'.length)
  const separatorIndex = worktreeId.indexOf('::')
  if (separatorIndex <= 0) {
    return undefined
  }
  return `id:${worktreeId.slice(0, separatorIndex)}`
}

async function getCreateRepoSelector(
  flags: Map<string, string | boolean>,
  cwdParentWorktree: string | undefined,
  client: Parameters<CommandHandler>[0]['client']
): Promise<string> {
  const projectRepoSelector = await resolveProjectCreateRepoSelector(flags, client)
  if (projectRepoSelector) {
    return projectRepoSelector
  }
  const explicitRepo = getPresentStringFlag(flags, 'repo')
  if (explicitRepo) {
    return explicitRepo
  }
  const inferredRepo = getRepoSelectorFromWorktreeSelector(cwdParentWorktree)
  if (inferredRepo) {
    return inferredRepo
  }
  throw new RuntimeClientError(
    'invalid_argument',
    'Missing repo selector. Pass --repo or run from inside an Orca-managed worktree.'
  )
}

export const WORKTREE_HANDLERS: Record<string, CommandHandler> = {
  'worktree ps': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeWorktreePsResult>('worktree.ps', {
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, formatWorktreePs)
  },
  'worktree list': async ({ flags, client, json }) => {
    const result = await client.call<RuntimeWorktreeListResult>('worktree.list', {
      repo: getOptionalStringFlag(flags, 'repo'),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, formatWorktreeList)
  },
  'worktree show': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
      worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    })
    printResult(result, json, formatWorktreeShow)
  },
  'worktree current': async ({ client, cwd, json }) => {
    const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
      worktree: await resolveCurrentWorktreeSelector(cwd, client)
    })
    printResult(result, json, formatWorktreeShow)
  },
  'worktree create': async ({ flags, client, cwd, json }) => {
    assertCreateParentFlagsCompatible(flags)
    assertWorkspaceTargetFlagsCompatible(flags)
    const callerTerminalHandle =
      typeof process.env.ORCA_TERMINAL_HANDLE === 'string' &&
      process.env.ORCA_TERMINAL_HANDLE.length > 0
        ? process.env.ORCA_TERMINAL_HANDLE
        : undefined
    const explicitParent = await resolveCreateParentSelector(flags, cwd, client)
    const explicitParentWorktree = explicitParent.parentWorktree
    const explicitParentWorkspace = explicitParent.parentWorkspace
    const startupAgent = getOptionalStartupAgent(flags)
    const setupDecision = getOptionalSetupDecision(flags)
    const noParent = flags.get('no-parent') === true
    const envParentWorkspace =
      !noParent && !explicitParentWorkspace && !explicitParentWorktree
        ? getEnvParentWorkspace()
        : undefined
    let cwdParentWorktree: string | undefined
    const needsCwdRepoInference = !flags.has('repo') && !hasWorkspaceProjectTarget(flags)
    if (
      (!explicitParentWorktree && !explicitParentWorkspace && !noParent) ||
      needsCwdRepoInference
    ) {
      try {
        // Why: agent shells can lose ORCA_TERMINAL_HANDLE while still running
        // inside an Orca worktree. Cwd keeps CLI-created children nestable and
        // lets create infer the repo for the common current-workspace case.
        cwdParentWorktree = await resolveCurrentWorktreeSelector(cwd, client)
      } catch {
        cwdParentWorktree = undefined
      }
    }
    const linearIssueLink = getOptionalLinearIssueLinkFlag(flags, 'linear-issue')
    const branchNameOverride = getOptionalStringFlag(flags, 'branch')
    const activate = flags.get('activate') === true || flags.get('run-hooks') === true
    const name = getRequiredStringFlag(flags, 'name')
    const result = await client.call<RuntimeWorktreeCreateResult>('worktree.create', {
      repo: await getCreateRepoSelector(flags, cwdParentWorktree, client),
      name,
      displayName: name,
      displayNameKind: 'user',
      baseBranch: getOptionalStringFlag(flags, 'base-branch'),
      // Why: --name is slugified into the branch, which collapses slashes, so
      // the CLI could not produce the `type/scope` branch names many teams
      // require. --branch reaches the same override the composer already
      // exposes, and the runtime validates it with `git check-ref-format`.
      ...(branchNameOverride ? { branchNameOverride } : {}),
      linkedIssue: getOptionalNumberFlag(flags, 'issue'),
      ...linearIssueLink,
      comment: getOptionalStringFlag(flags, 'comment'),
      ...(flags.get('terminal-group') === true ? { terminalGroup: true } : {}),
      runHooks: flags.get('run-hooks') === true,
      activate,
      // Why: the CLI pairs as a runtime device but is not a viewer, so caller-scoped
      // delivery would make --activate a no-op against a remote runtime.
      ...(activate ? { navigation: 'all' as const } : {}),
      ...(setupDecision ? { setupDecision } : {}),
      parentWorktree: explicitParentWorktree,
      ...(explicitParentWorkspace ? { parentWorkspace: explicitParentWorkspace } : {}),
      ...(envParentWorkspace ? { envParentWorkspace } : {}),
      ...(cwdParentWorktree ? { cwdParentWorktree } : {}),
      noParent,
      callerTerminalHandle,
      // Why: marks the workspace as CLI-created so the sidebar can badge and
      // filter it. Sent on every `worktree create` — hand-typed or agent-run.
      cliProvenanceRequest: callerTerminalHandle ? { callerTerminalHandle } : {},
      ...(startupAgent
        ? {
            startupAgent,
            startupPrompt: getPresentStringFlag(flags, 'prompt', { allowEmpty: true }) ?? ''
          }
        : {})
    })
    printHookWarning(result.result, json)
    printLineageSummary(result.result, json)
    printResult(result, json, formatWorktreeShow)
  },
  'worktree set': async ({ flags, client, cwd, json }) => {
    assertParentWorktreeFlagsCompatible(flags)
    const linearIssueLink = getOptionalLinearIssueLinkFlag(flags, 'linear-issue', {
      allowNull: true
    })
    const selector = await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    const jiraLink = await resolveJiraWorkItem(
      getOptionalJiraIssueLinkFlag(flags, 'jira', { allowNull: true }),
      client
    )
    // Attaching/tracking are additive, so the current lists have to be read before merging.
    const attaching = flags.has('add-pr') || flags.get('clear-prs') === true
    const tracking = flags.has('track-branch') || flags.get('clear-branches') === true
    const shown =
      attaching || tracking
        ? (
            await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
              worktree: selector
            })
          ).result?.worktree
        : undefined
    const result = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.set', {
      worktree: selector,
      ...getAttachedReviewsUpdate(flags, shown?.attachedReviews),
      ...getTrackedBranchesUpdate(flags, shown?.trackedBranches),
      displayName: getOptionalStringFlag(flags, 'display-name'),
      linkedIssue: getOptionalNullableNumberFlag(flags, 'issue'),
      ...linearIssueLink,
      ...jiraLink,
      comment: getOptionalStringFlag(flags, 'comment'),
      workspaceStatus: getOptionalStringFlag(flags, 'workspace-status'),
      parentWorktree: await getOptionalWorktreeSelector(flags, 'parent-worktree', cwd, client),
      noParent: flags.get('no-parent') === true
    })
    printResult(result, json, formatWorktreeShow)
  },
  'worktree rm': async ({ flags, client, cwd, json }) => {
    const worktree = await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    const resolved = await client.call<{ worktree: RuntimeWorktreeRecord }>('worktree.show', {
      worktree
    })
    const hostId = resolved.result.worktree.hostId
    if (!hostId) {
      throw new RuntimeClientError(
        'worktree_host_unresolved',
        'Orca cannot tell which host owns this workspace. Refresh projects and try again.'
      )
    }
    const result = await client.call<RuntimeWorktreeRemoveResult>('worktree.rm', {
      worktree,
      hostId,
      force: flags.get('force') === true,
      // Why (#11960): --force is explicit here, so it may also waive PTY-stop proof.
      allowUnverifiedPtyStop: flags.get('force') === true,
      runHooks: flags.get('run-hooks') === true
    })
    printHookWarning(result.result, json)
    printPreservedBranchWarning(result.result, json)
    printResult(result, json, (value) => `removed: ${value.removed}`)
  }
}
