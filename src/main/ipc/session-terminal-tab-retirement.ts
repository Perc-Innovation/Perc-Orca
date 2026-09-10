import type { Store } from '../persistence'
import { closeTerminalTabInWorkspaceSession } from '../../shared/workspace-session-terminal-tab-close'
import {
  advanceTerminalTopologyRevision,
  hasHostAuthoritativeTerminalMembership
} from '../runtime/workspace-session-terminal-membership-authority'

export type TerminalTabRetirementArgs = {
  worktreeId: string
  tabId: string
  hostId?: string | null
}

export type TerminalTabRetirementResult = {
  retired: boolean
  reason: 'retired' | 'renderer-authoritative' | 'absent'
}

/**
 * A user close the renderer reports, made durable under host-authoritative membership.
 *
 * Once a repo's topology fence is armed (a CLI terminal, a mobile close, an orphan adoption), the
 * membership rebase treats a renderer write that merely omits a row as a stale replay and puts the
 * row back; the durable de-persist was left to ride the PTY exit, which never comes for a shell
 * that already exited or was re-spawned under another id. The rows then come back on every
 * launch, each with a PTY nobody binds. This is the missing half: the same commit the mobile
 * close makes, keyed by tab id rather than PTY identity.
 *
 * Only under an armed fence, on purpose: below it the renderer's own write is authoritative, and
 * arming the fence here would make every later renderer write to that repo a replay.
 */
export function retireTerminalTabFromWorkspaceSession(
  store: Pick<Store, 'getWorkspaceSession' | 'setWorkspaceSession'>,
  args: TerminalTabRetirementArgs,
  owned?: ReadonlySet<string>
): TerminalTabRetirementResult {
  const session = store.getWorkspaceSession(args.hostId)
  if (!hasHostAuthoritativeTerminalMembership(session, args.worktreeId)) {
    return { retired: false, reason: 'renderer-authoritative' }
  }
  // Why force: the renderer already applied the user's decision, pinned or not.
  const result = closeTerminalTabInWorkspaceSession(session, args.worktreeId, args.tabId, {
    force: true
  })
  if (!result.closed) {
    return { retired: false, reason: 'absent' }
  }
  store.setWorkspaceSession(
    advanceTerminalTopologyRevision(result.session, args.worktreeId),
    args.hostId,
    owned
  )
  return { retired: true, reason: 'retired' }
}
