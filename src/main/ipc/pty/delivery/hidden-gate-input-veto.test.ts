import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

const sendModelRestoreNeededMarker = vi.hoisted(() => vi.fn())
vi.mock('./payload', () => ({ sendModelRestoreNeededMarker }))

import {
  _resetHiddenRendererPtyDeliveryGateForTest,
  markHiddenRendererPty,
  recordHiddenRendererPtyDataDrop,
  shouldDropHiddenRendererPtyData
} from '../../pty-hidden-delivery-gate'
import { mainDeliveryBreadcrumbs } from './debug'
import { revealHiddenRendererPtyOnInput } from './hidden-gate-input-veto'
import { transitionHiddenRendererPtyDeliveryState } from './hidden-transition'
import type { PtyIpcSession } from '../session'

const PTY = 'pty-frozen'
const WINDOW = 11
const SIBLING_WINDOW = 22

function makeSession(): PtyIpcSession & { syncPtyBackgroundedDelivery: ReturnType<typeof vi.fn> } {
  const session = {
    getSettings: () => ({}),
    syncPtyBackgroundedDelivery: vi.fn(),
    transitionHiddenRendererPtyDeliveryState: (id: string, hidden: boolean, windowId: number) =>
      transitionHiddenRendererPtyDeliveryState(
        session as unknown as PtyIpcSession,
        id,
        hidden,
        windowId
      ),
    runtime: { getPtyOutputSequence: () => 42 }
  }
  return session as unknown as PtyIpcSession & {
    syncPtyBackgroundedDelivery: ReturnType<typeof vi.fn>
  }
}

describe('revealHiddenRendererPtyOnInput', () => {
  beforeEach(() => {
    _resetHiddenRendererPtyDeliveryGateForTest()
    sendModelRestoreNeededMarker.mockClear()
  })

  // The wedge: the window said hidden, never said otherwise, and the user is typing into it.
  it('clears the typing window hidden mark and resumes delivery', () => {
    const session = makeSession()
    // No visible claim on purpose: this is the wedge the veto exists for — the window marked the
    // PTY hidden and never took it back, so nothing else can un-gate it.
    markHiddenRendererPty(PTY, WINDOW)
    expect(shouldDropHiddenRendererPtyData(PTY, {})).toBe(true)

    expect(revealHiddenRendererPtyOnInput(session, PTY, WINDOW)).toBe(true)

    expect(shouldDropHiddenRendererPtyData(PTY, {})).toBe(false)
    expect(session.syncPtyBackgroundedDelivery).toHaveBeenCalledWith(PTY, 'gate-input-veto')
    expect(
      mainDeliveryBreadcrumbs.snapshot().some((crumb) => crumb.kind === 'gate-input-veto')
    ).toBe(true)
  })

  it('refills the pane from the model when bytes were dropped under the mark', () => {
    const session = makeSession()
    markHiddenRendererPty(PTY, WINDOW)
    recordHiddenRendererPtyDataDrop(PTY, 1_024)

    revealHiddenRendererPtyOnInput(session, PTY, WINDOW)

    expect(sendModelRestoreNeededMarker).toHaveBeenCalledWith(session, PTY, 'unhide', 42)
  })

  it('is a no-op on the hot path when the window never marked the PTY hidden', () => {
    const session = makeSession()

    expect(revealHiddenRendererPtyOnInput(session, PTY, WINDOW)).toBe(false)

    expect(session.syncPtyBackgroundedDelivery).not.toHaveBeenCalled()
    expect(sendModelRestoreNeededMarker).not.toHaveBeenCalled()
  })

  // Why: a sibling window that parked the pane keeps its own opinion; only the typist's mark clears.
  it('leaves a sibling window mark alone', () => {
    const session = makeSession()
    markHiddenRendererPty(PTY, WINDOW)
    markHiddenRendererPty(PTY, SIBLING_WINDOW)

    revealHiddenRendererPtyOnInput(session, PTY, WINDOW)

    // The typing window no longer agrees it is hidden, so the drop is vetoed…
    expect(shouldDropHiddenRendererPtyData(PTY, {})).toBe(false)
    // …while the sibling's mark is untouched and would gate again once this window lets go.
    expect(revealHiddenRendererPtyOnInput(session, PTY, SIBLING_WINDOW)).toBe(true)
  })
})
