import type { FolderWorkspace } from '../shared/folder-workspace-types'

function formatFolderWorkspaceHost(workspace: FolderWorkspace): string {
  return workspace.connectionId ? `ssh:${workspace.connectionId}` : 'local'
}

export function formatFolderWorkspaceList(result: { folderWorkspaces: FolderWorkspace[] }): string {
  if (result.folderWorkspaces.length === 0) {
    return 'No folder workspaces found.'
  }
  return result.folderWorkspaces
    .map(
      (workspace) =>
        `${workspace.id}  ${workspace.name}  group:${workspace.projectGroupId}  host:${formatFolderWorkspaceHost(workspace)}  ${workspace.folderPath}`
    )
    .join('\n')
}

export function formatFolderWorkspaceCreateResult(result: {
  folderWorkspace: FolderWorkspace
}): string {
  const workspace = result.folderWorkspace
  return [
    `id: ${workspace.id}`,
    `name: ${workspace.name}`,
    `projectGroupId: ${workspace.projectGroupId}`,
    `host: ${formatFolderWorkspaceHost(workspace)}`,
    `path: ${workspace.folderPath}`
  ].join('\n')
}
