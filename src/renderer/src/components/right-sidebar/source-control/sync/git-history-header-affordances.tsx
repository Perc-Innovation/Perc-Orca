import { CircleHelp, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

/** Header affordance jumping from the docked branch history to the all-branches graph tab. */
export function GitHistoryOpenGraphButton({ onOpenGraph }: { onOpenGraph: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="my-auto h-auto w-auto p-0.5 text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent [&_svg]:size-3"
          aria-label={translate(
            'auto.components.right.sidebar.GitHistoryPanel.openGraph',
            'Open git graph'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onOpenGraph()
          }}
        >
          <GitBranch className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {translate(
          'auto.components.right.sidebar.GitHistoryPanel.openGraphTooltip',
          'Open the all-branches graph'
        )}
      </TooltipContent>
    </Tooltip>
  )
}

/** "What are refs?" help affordance for the history header. */
export function GitHistoryRefsHelpTooltip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="my-auto h-auto w-auto p-0.5 text-muted-foreground hover:bg-transparent hover:text-muted-foreground dark:hover:bg-transparent [&_svg]:size-3"
          aria-label={translate(
            'auto.components.right.sidebar.GitHistoryPanel.9289ba0cb9',
            'What are refs?'
          )}
          onClick={(event) => {
            event.stopPropagation()
          }}
        >
          <CircleHelp className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-72">
        {translate(
          'auto.components.right.sidebar.GitHistoryPanel.9f7535d22b',
          'Refs are branch or tag names pointing at that exact commit. They only appear where Git has a named ref for the commit.'
        )}
      </TooltipContent>
    </Tooltip>
  )
}
