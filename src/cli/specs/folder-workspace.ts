import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const FOLDER_WORKSPACE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['folder-workspace', 'list'],
    summary: 'List folder workspaces',
    usage: 'orca folder-workspace list [--group <id|name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'group'],
    notes: [
      'A folder workspace opens terminals in a plain directory — locally or on an SSH host — without creating a git worktree.'
    ],
    examples: ['orca folder-workspace list', 'orca folder-workspace list --group CCE --json']
  },
  {
    path: ['folder-workspace', 'create'],
    summary: 'Create a folder workspace in a project group',
    usage:
      'orca folder-workspace create --group <id|name> --name <name> [--path <path>] [--host local|ssh:<target-id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'group', 'name', 'path', 'host'],
    notes: [
      'Defaults: --path falls back to the group folder and --host to the group connection.',
      'The workspace may target a different host than its group: pass --host local, or --host ssh:<target-id> with an SSH target id from `orca folder-workspace list --json` or the SSH settings.',
      'With an SSH host, --path must be an absolute path on that host.'
    ],
    examples: [
      'orca folder-workspace create --group CCE --name "Mac terminal"',
      'orca folder-workspace create --group CCE --name "Raspi terminal" --host ssh:my-raspi --path /home/me/workspace/CCE --json'
    ]
  }
]
