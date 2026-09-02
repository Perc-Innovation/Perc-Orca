import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetPtyRendererDeliveryClaimsForTest,
  acquireHiddenRendererPtyDeliveryClaim,
  declareRendererPtyDeliveryVisible,
  forceRendererPtyDeliveryVisible,
  releaseRendererPtyVisibilityClaim,
  setRendererPtyVisibilityClaim
} from './pty-renderer-delivery-claims'

const PTY_ID = 'workspace@@pty-1'

describe('renderer PTY delivery claims', () => {
  const setHiddenRendererPty = vi.fn()
  const setRendererPtyVisible = vi.fn()

  beforeEach(() => {
    _resetPtyRendererDeliveryClaimsForTest()
    setHiddenRendererPty.mockReset()
    setRendererPtyVisible.mockReset()
    ;(globalThis as { window: Window }).window = {
      api: { pty: { setHiddenRendererPty, setRendererPtyVisible } }
    } as unknown as Window
  })

  it('keeps a PTY hidden across an overlapping pane-to-watcher handoff', () => {
    const releasePane = acquireHiddenRendererPtyDeliveryClaim(PTY_ID)
    const releaseWatcher = acquireHiddenRendererPtyDeliveryClaim(PTY_ID)

    expect(setHiddenRendererPty).toHaveBeenCalledTimes(1)
    expect(setHiddenRendererPty).toHaveBeenLastCalledWith(PTY_ID, true)

    releasePane()
    expect(setHiddenRendererPty).toHaveBeenCalledTimes(1)

    declareRendererPtyDeliveryVisible(PTY_ID)
    expect(setHiddenRendererPty).toHaveBeenCalledTimes(1)

    releaseWatcher()
    expect(setHiddenRendererPty).toHaveBeenLastCalledWith(PTY_ID, false)
    expect(setHiddenRendererPty).toHaveBeenCalledTimes(2)
  })

  it('does not let a retiring visible pane hide its replacement', () => {
    const oldPane = {}
    const newPane = {}
    setRendererPtyVisibilityClaim(oldPane, PTY_ID, true)
    setRendererPtyVisibilityClaim(newPane, PTY_ID, true)

    expect(setRendererPtyVisible).toHaveBeenCalledTimes(1)
    releaseRendererPtyVisibilityClaim(oldPane)
    expect(setRendererPtyVisible).toHaveBeenCalledTimes(1)

    releaseRendererPtyVisibilityClaim(newPane)
    expect(setRendererPtyVisible).toHaveBeenLastCalledWith(PTY_ID, false)
    expect(setRendererPtyVisible).toHaveBeenCalledTimes(2)
  })

  it('reports a never-visible mounted pane as known hidden', () => {
    setRendererPtyVisibilityClaim({}, PTY_ID, false)
    expect(setRendererPtyVisible).toHaveBeenCalledWith(PTY_ID, false)
  })

  // A claim whose owner is gone: nothing will ever release it, so the polite unmark defers to
  // it forever and main keeps dropping a visible pane's bytes.
  it('force-clears a leaked hidden claim the polite unmark would defer to', () => {
    acquireHiddenRendererPtyDeliveryClaim(PTY_ID)
    setHiddenRendererPty.mockClear()

    declareRendererPtyDeliveryVisible(PTY_ID)
    expect(setHiddenRendererPty).not.toHaveBeenCalled()

    expect(forceRendererPtyDeliveryVisible(PTY_ID)).toBe(true)
    expect(setHiddenRendererPty).toHaveBeenLastCalledWith(PTY_ID, false)
  })

  it('stays consistent when a live owner releases after a force clear', () => {
    const release = acquireHiddenRendererPtyDeliveryClaim(PTY_ID)
    forceRendererPtyDeliveryVisible(PTY_ID)
    setHiddenRendererPty.mockClear()

    release()
    // Why the same unmark again: a redundant unmark is idempotent on main; a re-mark would not be.
    expect(setHiddenRendererPty).toHaveBeenLastCalledWith(PTY_ID, false)

    acquireHiddenRendererPtyDeliveryClaim(PTY_ID)
    expect(setHiddenRendererPty).toHaveBeenLastCalledWith(PTY_ID, true)
  })

  it('reports nothing held when there was no claim to clear', () => {
    expect(forceRendererPtyDeliveryVisible(PTY_ID)).toBe(false)
    expect(setHiddenRendererPty).toHaveBeenLastCalledWith(PTY_ID, false)
  })
})
