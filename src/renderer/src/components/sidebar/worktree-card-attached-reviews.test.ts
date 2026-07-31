import { describe, expect, it } from 'vitest'
import { getExtraAttachedReviews } from './worktree-card-attached-reviews'
import type { AttachedReview } from '../../../../shared/types'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'

const attached = (over: Partial<AttachedReview> = {}): AttachedReview => ({
  provider: 'github',
  number: 294,
  url: 'https://github.com/acme/app/pull/294',
  ...over
})

// The metadata variant of the union: what a card renders without a hosted
// review snapshot, which is exactly the shape this helper compares against.
type PrDisplayMetadata = {
  provider: AttachedReview['provider']
  number: number
  title: string
  url?: string
}

const primary = (over: Partial<PrDisplayMetadata> = {}): WorktreeCardPrDisplay =>
  ({
    provider: 'github',
    number: 294,
    title: 'fix: something',
    url: 'https://github.com/acme/app/pull/294',
    ...over
  }) satisfies PrDisplayMetadata

describe('getExtraAttachedReviews', () => {
  it('returns nothing when there is nothing attached', () => {
    expect(getExtraAttachedReviews(undefined, primary())).toEqual([])
    expect(getExtraAttachedReviews(null, primary())).toEqual([])
    expect(getExtraAttachedReviews([], primary())).toEqual([])
  })

  it('drops the review already rendered as the header', () => {
    const list = getExtraAttachedReviews(
      [attached(), attached({ number: 295, url: 'https://github.com/acme/app/pull/295' })],
      primary()
    )
    expect(list.map((review) => review.number)).toEqual([295])
  })

  it('matches the header by url even when it differs in case or trailing slash', () => {
    // Why: the attached URL is whatever the user pasted; the auto-detected one
    // comes from the API. Showing the same PR twice is worse than missing one.
    const list = getExtraAttachedReviews(
      [attached({ url: 'https://GitHub.com/acme/app/pull/294/' })],
      primary()
    )
    expect(list).toEqual([])
  })

  it('falls back to provider and number when the urls do not match', () => {
    const list = getExtraAttachedReviews(
      [attached({ url: 'https://github.com/acme/app/pull/294?diff=split' })],
      primary()
    )
    expect(list).toEqual([])
  })

  it('keeps the same number from a different provider', () => {
    const list = getExtraAttachedReviews(
      [attached({ provider: 'gitlab', url: 'https://gitlab.com/acme/app/merge_requests/294' })],
      primary()
    )
    expect(list).toHaveLength(1)
  })

  it('keeps everything when nothing was auto-detected', () => {
    // Why: this is the case that matters most — a branch whose own review Orca
    // could not find still has the destinations the user attached by hand.
    const list = getExtraAttachedReviews(
      [attached(), attached({ number: 295, url: 'https://github.com/acme/app/pull/295' })],
      null
    )
    expect(list.map((review) => review.number)).toEqual([294, 295])
  })
})
