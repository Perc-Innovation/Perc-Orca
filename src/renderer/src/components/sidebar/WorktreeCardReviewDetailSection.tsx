import React from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Copy, Ellipsis, ExternalLink, MonitorUp, Unlink } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from './WorktreeCardDetailSection'
import { DetailHeader, MetadataActionIcon } from './WorktreeCardMetadataControls'
import { ReviewChecksBadge, ReviewStateBadge } from './WorktreeCardMetadataStatusBadges'
import type { AttachedReview } from '../../../../shared/types'
import type { WorktreeCardPrDisplay } from './worktree-card-pr-display'
import { getProviderName, getReviewLabel, ReviewIcon } from './worktree-review-helpers'

type WorktreeCardReviewDetailSectionProps = {
  review: WorktreeCardPrDisplay | null
  /** Reviews attached by hand, beyond the one detected from the branch. */
  extraReviews?: readonly AttachedReview[]
  reviewMenuOpen: boolean
  onReviewMenuOpenChange: (open: boolean) => void
  onOpenReviewInOrca?: (event: React.MouseEvent) => void
  onCopyReviewLink?: () => void
  onUnlinkReview?: () => void
  closeHover: () => void
}

export function WorktreeCardReviewDetailSection({
  review,
  extraReviews,
  reviewMenuOpen,
  onReviewMenuOpenChange,
  onOpenReviewInOrca,
  onCopyReviewLink,
  onUnlinkReview,
  closeHover
}: WorktreeCardReviewDetailSectionProps): React.JSX.Element | null {
  const extras = extraReviews ?? []
  if (!review) {
    // Why: a branch whose own review Orca could not find still has whatever the
    // user attached. Rendering nothing here is what hid them in the first place.
    return extras.length > 0 ? <AttachedReviewsOnlySection reviews={extras} /> : null
  }

  const reviewLabel = getReviewLabel(review)
  const reviewProvider = getProviderName(review)
  const moreActionsLabel = translate(
    'auto.components.sidebar.WorktreeCardMeta.dbe2d18972',
    'More {{value0}} actions',
    { value0: reviewLabel }
  )
  const moreActionsTrigger = (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="size-6"
        aria-label={moreActionsLabel}
        onClick={(event) => event.stopPropagation()}
      >
        <Ellipsis className="size-3" />
      </Button>
    </DropdownMenuTrigger>
  )
  const dismissAndOpenReview = (event: React.MouseEvent): void => {
    closeHover()
    onOpenReviewInOrca?.(event)
  }

  return (
    <WorktreeCardDetailSection>
      <DetailHeader
        icon={<ReviewIcon review={review} className="size-3" />}
        label={translate(
          'auto.components.sidebar.WorktreeCardReviewDetailSection.reviewHeader',
          '{{value0}} #{{value1}}',
          { value0: reviewLabel, value1: review.number }
        )}
        actions={
          <>
            {(onCopyReviewLink || onUnlinkReview) && (
              <DropdownMenu
                modal={false}
                open={reviewMenuOpen}
                onOpenChange={onReviewMenuOpenChange}
              >
                {reviewMenuOpen ? (
                  moreActionsTrigger
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>{moreActionsTrigger}</TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4}>
                      {moreActionsLabel}
                    </TooltipContent>
                  </Tooltip>
                )}
                <DropdownMenuContent align="end" className="w-40">
                  {onCopyReviewLink && (
                    <DropdownMenuItem
                      onSelect={() => {
                        closeHover()
                        onCopyReviewLink()
                      }}
                    >
                      <Copy className="size-3.5" />
                      {translate(
                        'auto.components.sidebar.WorktreeCardReviewDetailSection.copyLink',
                        'Copy link'
                      )}
                    </DropdownMenuItem>
                  )}
                  {onUnlinkReview && (
                    <DropdownMenuItem
                      onSelect={() => {
                        closeHover()
                        onUnlinkReview()
                      }}
                    >
                      <Unlink className="size-3.5" />
                      {translate(
                        'auto.components.sidebar.WorktreeCardMeta.ae76907ca6',
                        'Unlink {{value0}}',
                        { value0: reviewLabel }
                      )}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {review.url && onOpenReviewInOrca && (
              <MetadataActionIcon
                label={translate(
                  'auto.components.sidebar.WorktreeCardMeta.2c67730e07',
                  'Open in Orca'
                )}
                onClick={dismissAndOpenReview}
              >
                <MonitorUp className="size-3" />
              </MetadataActionIcon>
            )}
            {review.url && (
              <MetadataActionIcon
                label={translate(
                  'auto.components.sidebar.WorktreeCardMeta.ad25c3ff05',
                  'View on {{value0}}',
                  { value0: reviewProvider }
                )}
                href={review.url}
              >
                <ExternalLink className="size-3" />
              </MetadataActionIcon>
            )}
          </>
        }
      />
      <WorktreeCardDetailSectionContent className="space-y-1.5">
        <div className="text-[13px] font-semibold leading-snug text-foreground break-words">
          {review.title}
        </div>
        {(review.state || (review.status && review.status !== 'neutral')) && (
          <div className="flex flex-wrap gap-1">
            <ReviewStateBadge state={review.state} label={reviewLabel} />
            <ReviewChecksBadge status={review.status} />
          </div>
        )}
        <AttachedReviewRows reviews={extras} />
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}

function AttachedReviewsOnlySection({
  reviews
}: {
  reviews: readonly AttachedReview[]
}): React.JSX.Element {
  return (
    <WorktreeCardDetailSection>
      <DetailHeader
        icon={<ReviewIcon review={toDisplay(reviews[0])} className="size-3" />}
        label={translate(
          'auto.components.sidebar.WorktreeCardReviewDetailSection.attachedHeader',
          'Attached reviews'
        )}
      />
      <WorktreeCardDetailSectionContent>
        <AttachedReviewRows reviews={reviews} />
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}

/**
 * One compact row per attached review.
 *
 * These carry no check state — they are links the user asserted, not something
 * Orca polled — so the row shows where the review is headed instead, which is
 * the thing that tells two PRs off the same branch apart.
 */
function AttachedReviewRows({
  reviews
}: {
  reviews: readonly AttachedReview[]
}): React.JSX.Element | null {
  if (reviews.length === 0) {
    return null
  }

  return (
    <div className="space-y-0.5">
      {reviews.map((review) => {
        const display = toDisplay(review)
        return (
          <a
            key={review.url}
            href={review.url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="group flex items-center gap-1.5 rounded-sm px-1 py-0.5 -mx-1 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
            title={review.title ?? review.url}
          >
            <ReviewIcon review={display} className="size-3 shrink-0" />
            <span className="font-medium tabular-nums shrink-0">
              {getReviewLabel(display)} #{review.number}
            </span>
            {review.baseRef && (
              <span className="truncate text-muted-foreground/80">→ {review.baseRef}</span>
            )}
            <ExternalLink className="size-3 ml-auto shrink-0 opacity-0 group-hover:opacity-100" />
          </a>
        )
      })}
    </div>
  )
}

function toDisplay(review: AttachedReview): WorktreeCardPrDisplay {
  return { provider: review.provider, number: review.number, title: review.title ?? '' }
}
