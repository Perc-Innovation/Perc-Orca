import type { HostedReviewInfo } from './hosted-review'
import type { PRInfo } from './github/pull-request-types'

export function hostedReviewInfoFromGitHubPRInfo(pr: PRInfo): HostedReviewInfo {
  return {
    provider: 'github',
    number: pr.number,
    title: pr.title,
    state: pr.state,
    url: pr.url,
    status: pr.checksStatus,
    updatedAt: pr.updatedAt,
    mergeable: pr.mergeable,
    ...(pr.reviewDecision !== undefined ? { reviewDecision: pr.reviewDecision } : {}),
    ...(pr.autoMergeEnabled !== undefined ? { autoMergeEnabled: pr.autoMergeEnabled } : {}),
    ...(pr.autoMergeAllowed !== undefined ? { autoMergeAllowed: pr.autoMergeAllowed } : {}),
    ...(pr.mergeQueueRequired !== undefined ? { mergeQueueRequired: pr.mergeQueueRequired } : {}),
    ...(pr.mergeStateStatus !== undefined ? { mergeStateStatus: pr.mergeStateStatus } : {}),
    ...(pr.headSha ? { headSha: pr.headSha } : {}),
    ...(pr.prRepo ? { githubRepository: pr.prRepo } : {}),
    ...(pr.confirmedContainedHeadOid
      ? { confirmedContainedHeadOid: pr.confirmedContainedHeadOid }
      : {}),
    ...(pr.conflictSummary ? { conflictSummary: pr.conflictSummary } : {}),
    // El destino es lo que distingue dos reviews de la misma rama; sin esto la
    // única fila que Orca realmente poll-ea era la única sin él.
    ...(pr.baseRefName ? { baseRefName: pr.baseRefName } : {}),
    // Los hermanos salen del mismo lookup que la review. Este mapper es el
    // único puente al renderer, así que no copiarlos acá los tiraba enteros.
    ...(pr.siblings?.length ? { siblings: pr.siblings } : {})
  }
}
