import { redactPtyIdForDiagnostics } from '../../../../shared/pty-delivery-diagnostics'
import { mainDeliveryBreadcrumbs } from './debug'
import { unmarkHiddenRendererPtyForWindow } from './hidden-transition'
import { isHiddenRendererPtyInWindow } from './renderer-pty-window-claims'
import type { PtyIpcSession } from '../session'

/**
 * A window typing into a PTY is looking at it. Its own hidden mark on that PTY — "no visible
 * view needs these bytes" — is therefore false, whatever the renderer's bookkeeping says.
 *
 * Why main heals here instead of trusting the renderer to unmark: every wedge of this class
 * seen in the field (a leaked hidden refcount, a lost IPC unmark, the macOS occlusion tracker
 * stuck at hidden) ends the same way — main starving a pane the user is staring at, forever,
 * because the one signal that could clear the mark lives on the side that lost it. Keystrokes
 * cross to main on a channel proven alive, so the first one the user types into a frozen pane
 * becomes the repair: the mark clears, delivery resumes, and the restore marker refills what
 * was dropped from the model. Cost on the input path is one Set lookup per write.
 *
 * Automation also writes through this channel; unmarking for a pane nobody watches merely
 * delivers bytes a hidden pane buffers, which is the pre-gate behavior, not a regression.
 */
export function revealHiddenRendererPtyOnInput(
  session: PtyIpcSession,
  id: string,
  windowId: number
): boolean {
  if (!isHiddenRendererPtyInWindow(windowId, id)) {
    return false
  }
  mainDeliveryBreadcrumbs.record('gate-input-veto', {
    id: redactPtyIdForDiagnostics(id),
    windowId
  })
  unmarkHiddenRendererPtyForWindow(session, id, windowId, 'gate-input-veto')
  return true
}
