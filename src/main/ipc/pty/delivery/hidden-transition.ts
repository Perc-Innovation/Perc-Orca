import {
  consumeHiddenRendererPtyDropLatch,
  markHiddenRendererPty,
  shouldDropHiddenRendererPtyData,
  unmarkHiddenRendererPty
} from '../../pty-hidden-delivery-gate'
import { IMPLICIT_RENDERER_WINDOW_ID } from './renderer-pty-window-claims'
import { invalidatePendingPtyDrainPolicy } from './visibility-state'
import type { PtyIpcSession } from '../session'
import { sendModelRestoreNeededMarker } from './payload'

export function transitionHiddenRendererPtyDeliveryState(
  session: PtyIpcSession,
  id: string,
  hidden: boolean,
  windowId: number = IMPLICIT_RENDERER_WINDOW_ID
): { droppable: boolean; droppedWhileHidden: boolean; policyChanged: boolean } {
  const settings = session.getSettings?.()
  const wasDroppable = shouldDropHiddenRendererPtyData(id, settings)
  if (hidden) {
    markHiddenRendererPty(id, windowId)
  } else {
    unmarkHiddenRendererPty(id, windowId)
  }
  const droppable = shouldDropHiddenRendererPtyData(id, settings)
  // Why the policy transition owns the latch: with several windows a sibling's unmark can leave
  // the PTY droppable, and consuming there would swallow the restore the revealing window needs.
  const droppedWhileHidden = wasDroppable && !droppable && consumeHiddenRendererPtyDropLatch(id)
  return { droppable, droppedWhileHidden, policyChanged: wasDroppable !== droppable }
}

export function transitionSpawnHiddenRendererPtyDeliveryState(
  session: PtyIpcSession,
  id: string,
  hidden: boolean
): void {
  const transition = transitionHiddenRendererPtyDeliveryState(session, id, hidden)
  if (transition.policyChanged) {
    invalidatePendingPtyDrainPolicy(id)
  }
}

/**
 * One window clearing its hidden bit, with everything an unmark owes: the drain policy
 * re-evaluated, backgrounded delivery re-synced, and — when bytes were dropped meanwhile —
 * the restore marker that makes the pane refill from main's model. Shared by the renderer's
 * own unmark and the input veto so the two paths cannot drift.
 */
export function unmarkHiddenRendererPtyForWindow(
  session: PtyIpcSession,
  id: string,
  windowId: number,
  caller: string
): void {
  const transition = transitionHiddenRendererPtyDeliveryState(session, id, false, windowId)
  if (transition.policyChanged) {
    invalidatePendingPtyDrainPolicy(id)
  }
  session.syncPtyBackgroundedDelivery(id, caller)
  // Why re-emit on every unhide: a reload/remount may have replaced the view that latched
  // restore-needed; a redundant replay is cheap and idempotent, a missed restore corrupts the pane.
  if (transition.droppedWhileHidden) {
    sendModelRestoreNeededMarker(session, id, 'unhide', session.runtime?.getPtyOutputSequence(id))
  }
}
