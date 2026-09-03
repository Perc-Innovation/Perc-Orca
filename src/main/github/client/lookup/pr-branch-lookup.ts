import { ghExecFileAsync } from '../../gh-utils'
import type { OwnerRepo, ghRepoExecOptions } from '../../gh-utils'
import { githubHostExecOptions, type GitHubApiRepository } from '../../github-api-repository'
import type { GhExecOptions } from './../github-exec-scope'
import { isNoPullRequestError } from './../gh-error-predicates'
import {
  PR_LOOKUP_JSON_FIELDS,
  PR_BRANCH_LIST_JSON_FIELDS,
  mapRestPullRequest,
  normalizePullRequestLookupData,
  type PullRequestLookupData,
  type RestPullRequest
} from './pull-request-lookup-data'
import { getPRByNumber } from './pr-number-lookup'
// Why more than one: a branch can feed several PRs at once (the repo base, stage, a release),
// and GitHub lists them newest first — asking for one hid the live PR behind a newer closed one.
// High enough for a long-lived branch's closed PRs, bounded so retries never paginate unchecked.
const MAX_BRANCH_PRS = 30

export async function getRestPRForBranch(
  prRepo: GitHubApiRepository,
  headOwner: string,
  branchName: string,
  ghOptions: ReturnType<typeof ghRepoExecOptions>
): Promise<PullRequestLookupData | null> {
  const head = encodeURIComponent(`${headOwner}:${branchName}`)
  const { stdout } = await ghExecFileAsync(
    [
      'api',
      `repos/${prRepo.owner}/${prRepo.repo}/pulls?head=${head}&state=all&per_page=${MAX_BRANCH_PRS}`
    ],
    { ...ghOptions, ...githubHostExecOptions(prRepo) }
  )
  const list = JSON.parse(stdout) as RestPullRequest[]
  const pr = pickPrimaryPRForBranch(list)
  if (!pr) {
    return null
  }
  const others = list.filter((candidate) => candidate.number !== pr.number)
  return {
    ...mapRestPullRequest(pr),
    ...(others.length > 0 ? { siblings: others } : {})
  }
}

/**
 * Which of a branch's PRs represents it: what the user can still act on wins — open, then
 * merged, and only with nothing live the newest. Picking a merged one does not show it by
 * itself; `hideMergedImplicitPR` still decides whether an implicit lookup may surface it.
 */
function pickPrimaryPRForBranch(list: readonly RestPullRequest[]): RestPullRequest | undefined {
  return (
    list.find((pr) => pr.state === 'open') ?? list.find((pr) => Boolean(pr.merged_at)) ?? list[0]
  )
}

export async function getFallbackPRListForBranch(
  prRepo: GitHubApiRepository,
  branchName: string,
  ghOptions: ReturnType<typeof ghRepoExecOptions>
): Promise<PullRequestLookupData | null> {
  const { stdout } = await ghExecFileAsync(
    [
      'pr',
      'list',
      '--repo',
      `${prRepo.owner}/${prRepo.repo}`,
      '--head',
      branchName,
      '--state',
      'all',
      '--limit',
      '1',
      '--json',
      PR_BRANCH_LIST_JSON_FIELDS
    ],
    { ...ghOptions, ...githubHostExecOptions(prRepo) }
  )
  const list = JSON.parse(stdout) as PullRequestLookupData[]
  return list[0] ?? null
}

export async function hydrateBranchLookupWithExactPR(
  ownerRepo: OwnerRepo,
  branchData: PullRequestLookupData | null,
  ghOptions: GhExecOptions,
  executionScope: string
): Promise<PullRequestLookupData | null> {
  if (!branchData) {
    return null
  }
  try {
    const exact = await getPRByNumber(
      ownerRepo,
      branchData.number,
      ghOptions,
      executionScope,
      branchData
    )
    if (!exact) {
      return branchData
    }
    // Why: the exact detail knows nothing about the branch, so the siblings only exist on the
    // branch lookup and have to be carried over or they are lost here.
    return branchData.siblings ? { ...exact, siblings: branchData.siblings } : exact
  } catch {
    return branchData
  }
}

export async function lookupPRByBranchName(args: {
  candidates: OwnerRepo[]
  headRepo: OwnerRepo | null
  branchName: string
  ghOptions: GhExecOptions
  executionScope: string
}): Promise<{
  data: PullRequestLookupData | null
  dataRepo: OwnerRepo | null
  pendingError?: unknown
}> {
  if (args.candidates.length > 0) {
    let pendingError: unknown
    let hasPendingError = false
    for (const candidate of args.candidates) {
      try {
        const branchData = args.headRepo
          ? await getRestPRForBranch(
              candidate,
              args.headRepo.owner,
              args.branchName,
              args.ghOptions
            )
          : await getFallbackPRListForBranch(candidate, args.branchName, args.ghOptions)
        // Why: REST/list branch lookup identifies the PR cheaply; exact `gh pr view` carries review, merge-queue, and auto-merge state.
        const data = await hydrateBranchLookupWithExactPR(
          candidate,
          branchData,
          args.ghOptions,
          args.executionScope
        )
        if (data) {
          return { data, dataRepo: candidate }
        }
      } catch (err) {
        if (args.headRepo) {
          throw err
        }
        if (!hasPendingError) {
          pendingError = err
          hasPendingError = true
        }
        try {
          const branchData = await getRestPRForBranch(
            candidate,
            candidate.owner,
            args.branchName,
            args.ghOptions
          )
          const data = await hydrateBranchLookupWithExactPR(
            candidate,
            branchData,
            args.ghOptions,
            args.executionScope
          )
          if (data) {
            return { data, dataRepo: candidate }
          }
        } catch (retryErr) {
          if (!hasPendingError) {
            pendingError = retryErr
            hasPendingError = true
          }
        }
      }
    }
    // Why: branch-list failures are ambiguous for fork discovery; give exact fallback-number recovery a chance before surfacing the error.
    return hasPendingError
      ? { data: null, dataRepo: null, pendingError }
      : { data: null, dataRepo: null }
  }

  try {
    const { stdout } = await ghExecFileAsync(
      ['pr', 'view', args.branchName, '--json', PR_LOOKUP_JSON_FIELDS],
      args.ghOptions
    )
    return {
      data: normalizePullRequestLookupData(JSON.parse(stdout) as PullRequestLookupData),
      dataRepo: null
    }
  } catch (err) {
    if (isNoPullRequestError(err)) {
      return { data: null, dataRepo: null }
    }
    throw err
  }
}
