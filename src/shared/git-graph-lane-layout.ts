import {
  GIT_HISTORY_LANE_COLORS,
  GIT_HISTORY_REF_COLOR,
  type GitHistoryGraphColorId,
  type GitHistoryItem,
  type GitHistoryItemRef
} from './git-history-types'
import { buildGitHistoryViewModels, type GitHistoryItemViewModel } from './git-history-graph'
import { splitRemoteBranchName } from './git-remote-branch-name'

export type { GitHistoryItemViewModel } from './git-history-graph'

// Why: a local branch and its remote-tracking refs should share one lane color
// even when they sit on different commits, matching how users think of "the
// branch" as one line of work.
function logicalBranchKey(ref: GitHistoryItemRef): string | null {
  if (ref.category === 'branches') {
    return ref.name
  }
  if (ref.category === 'remote branches') {
    // Why: without configured remote names, `foo/bar/main` could be remote
    // `foo` branch `bar/main` or remote `foo/bar` branch `main` — keep
    // ambiguous refs on their own color instead of guessing a grouping.
    if (ref.name.split('/').length > 2) {
      return ref.id
    }
    return splitRemoteBranchName(ref.name)?.branchName ?? ref.id
  }
  return null
}

// Assigns each branch a stable lane color by topological order of its tip:
// the current branch keeps the HEAD accent, other branches cycle the lane
// palette, and tags inherit whichever lane color their commit lands on.
export function buildGitGraphColorMap(
  items: readonly GitHistoryItem[],
  currentRef?: GitHistoryItemRef
): Map<string, GitHistoryGraphColorId | undefined> {
  const colorMap = new Map<string, GitHistoryGraphColorId | undefined>()
  const colorByLogicalBranch = new Map<string, GitHistoryGraphColorId>()
  let laneColorIndex = 0

  if (currentRef) {
    colorMap.set(currentRef.id, GIT_HISTORY_REF_COLOR)
    const currentKey = logicalBranchKey(currentRef)
    if (currentKey !== null) {
      colorByLogicalBranch.set(currentKey, GIT_HISTORY_REF_COLOR)
    }
  }

  for (const item of items) {
    for (const ref of item.references ?? []) {
      if (colorMap.has(ref.id)) {
        continue
      }
      const key = logicalBranchKey(ref)
      if (key === null) {
        if (ref.category === 'tags') {
          // Why: an explicit undefined entry makes the view model resolve the
          // tag pill to its commit's lane color instead of the neutral border.
          colorMap.set(ref.id, undefined)
        }
        continue
      }
      let color = colorByLogicalBranch.get(key)
      if (color === undefined) {
        color = GIT_HISTORY_LANE_COLORS[laneColorIndex % GIT_HISTORY_LANE_COLORS.length]!
        laneColorIndex += 1
        colorByLogicalBranch.set(key, color)
      }
      colorMap.set(ref.id, color)
    }
  }

  return colorMap
}

// Lays out the whole-repo graph: swimlane assignment comes from the shared
// view-model builder, colors from the stable per-branch map above. Boundary
// rows never apply here — with every ref in the walk there is no hidden
// upstream to synthesize.
export function buildGitGraphRows(
  items: GitHistoryItem[],
  currentRef?: GitHistoryItemRef
): GitHistoryItemViewModel[] {
  return buildGitHistoryViewModels(items, buildGitGraphColorMap(items, currentRef), currentRef)
}
