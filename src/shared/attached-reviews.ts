/**
 * A review explicitly attached to a workspace, on top of the one auto-detected
 * from the branch.
 *
 * Why a separate list instead of turning `linkedPR` and friends into arrays:
 * those scalars are read in ~57 files across renderer, main and CLI, and each
 * provider has its own. Keeping them untouched means auto-detection, the card's
 * primary review and every existing consumer behave exactly as before, and only
 * code that wants the extras opts in.
 *
 * The common case for more than one is a single branch that ships to several
 * destinations (a release branch plus trunk) or a feature split across repos.
 */
export type AttachedReview = {
  provider: 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'gitea'
  number: number
  url: string
  /** Destination branch, when known. It is what distinguishes reviews that
   *  share a head branch, so it is worth storing rather than re-fetching. */
  baseRef?: string
  title?: string
  /** Whether the review is still live. Attached reviews are not polled, so this
   *  is whatever the caller knew when it attached them — without it a merged
   *  review and an open one render identically, which is the opposite of what
   *  a stack of destinations is for. */
  state?: 'open' | 'merged' | 'closed' | 'draft'
}

const PROVIDERS: readonly AttachedReview['provider'][] = [
  'github',
  'gitlab',
  'bitbucket',
  'azure-devops',
  'gitea'
]
const PROVIDER_SET = new Set<string>(PROVIDERS)

/** Corruption guard, not a product limit — a feature spanning more repos than
 *  this is possible, but a persisted list longer than it is damaged data. */
const MAX_ATTACHED_REVIEWS = 50
const MAX_TITLE_LENGTH = 200
const STATES = new Set(['open', 'merged', 'closed', 'draft'])

/**
 * Normalizes the persisted attached-review list.
 *
 * Anything unrecognizable is dropped rather than repaired: a review with no
 * usable URL cannot be opened, and one with no number cannot be told apart
 * from its siblings, so a partial entry would only render a dead row.
 *
 * Duplicates are collapsed by URL, which is what makes attaching the same
 * review twice a no-op instead of a growing list.
 */
export function normalizeAttachedReviews(value: unknown): AttachedReview[] {
  if (!Array.isArray(value)) {
    return []
  }

  const out: AttachedReview[] = []
  const seen = new Set<string>()

  for (const raw of value.slice(0, MAX_ATTACHED_REVIEWS)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      continue
    }
    const item = raw as Record<string, unknown>

    if (typeof item.provider !== 'string' || !PROVIDER_SET.has(item.provider)) {
      continue
    }
    if (typeof item.number !== 'number' || !Number.isInteger(item.number) || item.number <= 0) {
      continue
    }
    if (typeof item.url !== 'string' || !isUsableUrl(item.url)) {
      continue
    }

    const key = item.url.trim().toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)

    const review: AttachedReview = {
      provider: item.provider as AttachedReview['provider'],
      number: item.number,
      url: item.url.trim()
    }
    if (typeof item.baseRef === 'string' && item.baseRef.trim().length > 0) {
      review.baseRef = item.baseRef.trim()
    }
    if (typeof item.title === 'string' && item.title.trim().length > 0) {
      review.title = item.title.trim().slice(0, MAX_TITLE_LENGTH)
    }
    if (typeof item.state === 'string' && STATES.has(item.state)) {
      review.state = item.state as AttachedReview['state']
    }
    out.push(review)
  }

  return out
}

/**
 * Adds a review to the list, replacing any entry with the same URL so
 * re-attaching refreshes the title and base instead of duplicating the row.
 */
export function addAttachedReview(
  current: readonly AttachedReview[] | undefined,
  review: AttachedReview
): AttachedReview[] {
  // Why: drop the existing entry first. Normalizing a list that contains both
  // keeps the *first* occurrence, which would silently discard the new title
  // and base instead of refreshing them.
  const key = review.url.trim().toLowerCase()
  const rest = (current ?? []).filter((item) => item.url.trim().toLowerCase() !== key)
  return normalizeAttachedReviews([...rest, review])
}

function isUsableUrl(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}
