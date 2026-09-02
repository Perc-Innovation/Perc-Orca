import type { ProjectGroup } from '../../../../shared/project-group-types'
import type { Repo } from '../../../../shared/repo-types'
import type { FolderWorkspace } from '../../../../shared/folder-workspace-types'
import { getProjectGroupSubtreeIds } from '../../../../shared/project-groups'
import { resolveWorkspaceProjectGroupId } from '../../../../shared/workspace-project-group'

/**
 * A workspace is a root project group — no new entity. The sidebar shows one at a time, and the
 * window's project filter (`filterGroupIds`, already per-window) is where the choice lives: a
 * project window derives exactly the same thing from its scope, so both window kinds agree on
 * what "the workspace I am in" means.
 *
 * Projects with no group are their own option rather than a hidden remainder: they are the one
 * thing a group-shaped filter cannot name, and 14 of them silently disappearing is what made the
 * filter unusable as a workspace switcher.
 */

export type WorkspaceOption =
  | { kind: 'group'; id: string; name: string; repoCount: number; workspaceCount: number }
  | { kind: 'ungrouped'; id: null; repoCount: number; repoIds: readonly string[] }

export type ActiveWorkspace = {
  option: WorkspaceOption | null
  /** A subgroup or extra project picks are still on top of the workspace: the label says so. */
  narrowed: boolean
  /** The filter matches no single workspace (a multi-group pick from before this UI existed). */
  custom: boolean
}

type WorkspaceOptionsInput = {
  repos: readonly Pick<Repo, 'id' | 'projectGroupId'>[]
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId' | 'name' | 'tabOrder'>[]
  folderWorkspaces: readonly Pick<FolderWorkspace, 'projectGroupId'>[]
}

function compareForDisplay(
  left: Pick<ProjectGroup, 'name' | 'tabOrder'>,
  right: Pick<ProjectGroup, 'name' | 'tabOrder'>
): number {
  return left.tabOrder - right.tabOrder || left.name.localeCompare(right.name)
}

/** Roots in sidebar order, then the ungrouped option — omitted when every project has a group. */
export function buildWorkspaceOptions(input: WorkspaceOptionsInput): WorkspaceOption[] {
  // Why dedupe: the same group id is listed once per host, and the switcher shows it once.
  const groupsById = new Map<string, WorkspaceOptionsInput['projectGroups'][number]>()
  for (const group of input.projectGroups) {
    if (!groupsById.has(group.id)) {
      groupsById.set(group.id, group)
    }
  }
  const groups = [...groupsById.values()]
  const roots = groups
    .filter((group) => !group.parentGroupId || !groupsById.has(group.parentGroupId))
    .sort(compareForDisplay)
  const options: WorkspaceOption[] = roots.map((root) => {
    const subtreeIds = getProjectGroupSubtreeIds(groups, root.id)
    return {
      kind: 'group',
      id: root.id,
      name: root.name,
      repoCount: input.repos.filter(
        (repo) => repo.projectGroupId && subtreeIds.has(repo.projectGroupId)
      ).length,
      workspaceCount: input.folderWorkspaces.filter((workspace) =>
        subtreeIds.has(workspace.projectGroupId)
      ).length
    }
  })
  const ungroupedRepoIds = input.repos
    .filter((repo) => !repo.projectGroupId || !groupsById.has(repo.projectGroupId))
    .map((repo) => repo.id)
  if (ungroupedRepoIds.length > 0) {
    options.push({
      kind: 'ungrouped',
      id: null,
      repoCount: ungroupedRepoIds.length,
      repoIds: ungroupedRepoIds
    })
  }
  return options
}

/** What the window's filter has to say for this option to be the one selected. */
export function workspaceSelectionFilter(option: WorkspaceOption): {
  filterGroupIds: string[]
  filterRepoIds: string[]
} {
  return option.kind === 'group'
    ? { filterGroupIds: [option.id], filterRepoIds: [] }
    : { filterGroupIds: [], filterRepoIds: [...option.repoIds] }
}

function sameIdSet(left: readonly string[], right: readonly string[]): boolean {
  const leftIds = new Set(left)
  const rightIds = new Set(right)
  return leftIds.size === rightIds.size && [...leftIds].every((id) => rightIds.has(id))
}

/**
 * Reads the workspace back out of the filter. An empty filter is "never chosen", not "all": the
 * sidebar shows one workspace at a time, so nothing selected is a state to seed, not to render.
 */
export function resolveActiveWorkspace(args: {
  options: readonly WorkspaceOption[]
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[]
  filterGroupIds: readonly string[]
  filterRepoIds: readonly string[]
}): ActiveWorkspace {
  const { options, filterGroupIds, filterRepoIds } = args
  if (filterGroupIds.length === 0 && filterRepoIds.length === 0) {
    return { option: null, narrowed: false, custom: false }
  }
  if (filterGroupIds.length === 0) {
    const ungrouped = options.find((option) => option.kind === 'ungrouped')
    if (ungrouped?.kind === 'ungrouped' && sameIdSet(ungrouped.repoIds, filterRepoIds)) {
      return { option: ungrouped, narrowed: false, custom: false }
    }
    return { option: null, narrowed: false, custom: true }
  }
  const roots = new Set(
    filterGroupIds.map((groupId) => rootGroupIdOf(args.projectGroups, groupId) ?? groupId)
  )
  if (roots.size !== 1) {
    return { option: null, narrowed: false, custom: true }
  }
  const [rootId] = [...roots]
  const option = options.find((entry) => entry.kind === 'group' && entry.id === rootId)
  if (!option) {
    return { option: null, narrowed: false, custom: true }
  }
  const exact = filterGroupIds.length === 1 && filterGroupIds[0] === rootId
  return { option, narrowed: !exact || filterRepoIds.length > 0, custom: false }
}

/** Walks up to the root; a cycle or a missing parent stops the walk rather than hanging. */
export function rootGroupIdOf(
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[],
  groupId: string
): string | null {
  const parentById = new Map(projectGroups.map((group) => [group.id, group.parentGroupId ?? null]))
  if (!parentById.has(groupId)) {
    return null
  }
  const seen = new Set<string>()
  let current = groupId
  while (!seen.has(current)) {
    seen.add(current)
    const parent = parentById.get(current)
    if (!parent || !parentById.has(parent)) {
      return current
    }
    current = parent
  }
  return current
}

/**
 * The workspace to open a window on when it has never chosen one: the one holding the workspace
 * the user was last in. Landing them where they were beats landing them on whatever sorts first.
 */
export function resolveWorkspaceForActiveWorkspaceKey(args: {
  options: readonly WorkspaceOption[]
  projectGroups: readonly Pick<ProjectGroup, 'id' | 'parentGroupId'>[]
  repos: readonly Pick<Repo, 'id' | 'projectGroupId'>[]
  folderWorkspaces: readonly Pick<FolderWorkspace, 'id' | 'projectGroupId'>[]
  activeWorkspaceKey: string | null
}): WorkspaceOption | null {
  const { options, activeWorkspaceKey } = args
  if (options.length === 0) {
    return null
  }
  if (activeWorkspaceKey === null) {
    return options[0] ?? null
  }
  const repoById = new Map(args.repos.map((repo) => [repo.id, repo]))
  const groupId = resolveWorkspaceProjectGroupId(
    {
      getRepo: (repoId) => repoById.get(repoId),
      getFolderWorkspaces: () => args.folderWorkspaces
    },
    activeWorkspaceKey
  )
  if (groupId === null) {
    // No group: the ungrouped option holds it, and only if that option exists at all.
    return options.find((option) => option.kind === 'ungrouped') ?? options[0] ?? null
  }
  const rootId = rootGroupIdOf(args.projectGroups, groupId)
  return (
    options.find((option) => option.kind === 'group' && option.id === rootId) ?? options[0] ?? null
  )
}
