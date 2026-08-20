import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { ProjectGroup } from '../../shared/project-group-types'
import type { CommandHandler } from '../dispatch'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import {
  formatFolderWorkspaceCreateResult,
  formatFolderWorkspaceList,
  printResult
} from '../format'
import { resolveRepoPathArgument } from '../repo-path-arguments'
import { RuntimeClientError } from '../runtime-client'

function resolveProjectGroup(groups: ProjectGroup[], selector: string): ProjectGroup {
  const byId = groups.find((group) => group.id === selector)
  if (byId) {
    return byId
  }
  const wanted = selector.trim().toLowerCase()
  const byName = groups.filter((group) => group.name.trim().toLowerCase() === wanted)
  if (byName.length === 1) {
    return byName[0]
  }
  if (byName.length > 1) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--group "${selector}" matches ${byName.length} groups; pass an id instead: ${byName.map((group) => group.id).join(', ')}`
    )
  }
  const known = groups.map((group) => group.name).join(', ')
  throw new RuntimeClientError(
    'invalid_argument',
    `No project group matches "${selector}".${known ? ` Known groups: ${known}` : ''}`
  )
}

/** Maps --host to the wire value: undefined inherits the group connection, null is explicitly local. */
function resolveHostFlagConnectionId(host: string | undefined): string | null | undefined {
  if (host === undefined) {
    return undefined
  }
  if (host === 'local') {
    return null
  }
  const raw = host.startsWith('ssh:') ? decodeURIComponent(host.slice('ssh:'.length)) : host
  if (!raw) {
    throw new RuntimeClientError('invalid_argument', '--host must be local or ssh:<target-id>')
  }
  return raw
}

export const FOLDER_WORKSPACE_HANDLERS: Record<string, CommandHandler> = {
  'folder-workspace list': async ({ flags, client, json }) => {
    const groupSelector = getOptionalStringFlag(flags, 'group')
    const result = await client.call<{ folderWorkspaces: FolderWorkspace[] }>(
      'folderWorkspace.list'
    )
    let folderWorkspaces = result.result.folderWorkspaces
    if (groupSelector !== undefined) {
      const groups = (await client.call<{ groups: ProjectGroup[] }>('projectGroup.list')).result
        .groups
      const group = resolveProjectGroup(groups, groupSelector)
      folderWorkspaces = folderWorkspaces.filter(
        (workspace) => workspace.projectGroupId === group.id
      )
    }
    printResult({ ...result, result: { folderWorkspaces } }, json, formatFolderWorkspaceList)
  },
  'folder-workspace create': async ({ flags, client, cwd, json }) => {
    const groupSelector = getRequiredStringFlag(flags, 'group')
    const name = getRequiredStringFlag(flags, 'name')
    const rawPath = getOptionalStringFlag(flags, 'path')
    const connectionId = resolveHostFlagConnectionId(getOptionalStringFlag(flags, 'host'))
    const groups = (await client.call<{ groups: ProjectGroup[] }>('projectGroup.list')).result
      .groups
    const group = resolveProjectGroup(groups, groupSelector)
    const effectiveConnectionId =
      connectionId === undefined ? (group.connectionId ?? null) : connectionId
    let folderPath: string | undefined
    if (rawPath !== undefined) {
      if (effectiveConnectionId) {
        if (!rawPath.startsWith('/')) {
          throw new RuntimeClientError(
            'invalid_argument',
            'With an SSH host, --path must be an absolute path on that host.'
          )
        }
        folderPath = rawPath
      } else {
        folderPath = resolveRepoPathArgument(rawPath, cwd, client.isRemote, 'Folder workspace')
      }
    }
    const result = await client.call<{ folderWorkspace: FolderWorkspace }>(
      'folderWorkspace.create',
      {
        projectGroupId: group.id,
        name,
        ...(folderPath !== undefined ? { folderPath } : {}),
        ...(connectionId !== undefined ? { connectionId } : {})
      }
    )
    printResult(result, json, formatFolderWorkspaceCreateResult)
  }
}
