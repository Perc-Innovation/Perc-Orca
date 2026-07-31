import type { AttachedReview } from '../../../../shared/types'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'

/**
 * Picks the attached reviews worth showing next to the branch's own review.
 *
 * A branch that ships to several destinations has one review Orca finds on its
 * own and N the user attached. The auto-detected one is already rendered as the
 * section header, so it is dropped here to avoid showing the same PR twice —
 * matched by URL first, then by provider+number, because the same PR can be
 * attached with a slightly different URL than the API returned.
 */
export function getExtraAttachedReviews(
  attachedReviews: readonly AttachedReview[] | null | undefined,
  primary: WorktreeCardPrDisplay | null
): AttachedReview[] {
  if (!attachedReviews?.length) {
    return []
  }

  const primaryUrl = primary?.url ? normalizeUrl(primary.url) : null
  const primaryKey = primary ? `${primary.provider}#${primary.number}` : null

  return attachedReviews.filter((review) => {
    if (primaryUrl && normalizeUrl(review.url) === primaryUrl) {
      return false
    }
    return primaryKey === null || `${review.provider}#${review.number}` !== primaryKey
  })
}

function normalizeUrl(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, '')
}
