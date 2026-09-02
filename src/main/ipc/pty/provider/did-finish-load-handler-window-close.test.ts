import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))

import type { WebContents } from 'electron'
import {
  clearDidFinishLoadHandlerOnWindowClosed,
  didFinishLoadHandlersByWebContents,
  setDidFinishLoadHandler
} from './listener-lifecycle'

/**
 * `closed` fires after the window is destroyed, so anything the listener reads off the window
 * throws. A window stub whose `webContents` getter throws is what a destroyed BrowserWindow does.
 */
function destroyedWindow(): {
  once: (event: 'closed', listener: () => void) => void
  readonly webContents: WebContents
  close: () => void
} {
  let onClosed: (() => void) | null = null
  return {
    once: (event, listener) => {
      if (event === 'closed') {
        onClosed = listener
      }
    },
    get webContents(): WebContents {
      throw new TypeError('Object has been destroyed')
    },
    close: () => onClosed?.()
  }
}

function fakeWebContents(): WebContents {
  return { removeListener: vi.fn() } as unknown as WebContents
}

describe('clearDidFinishLoadHandlerOnWindowClosed', () => {
  it('drops the handler without touching the destroyed window', () => {
    const contents = fakeWebContents()
    const handler = vi.fn()
    setDidFinishLoadHandler(handler, contents)
    const window = destroyedWindow()

    clearDidFinishLoadHandlerOnWindowClosed(window, contents)

    // Reading `window.webContents` here is what raised "A JavaScript error occurred in the main
    // process"; it also left the entry behind, since the throw came before the delete.
    expect(() => window.close()).not.toThrow()
    expect(didFinishLoadHandlersByWebContents.has(contents)).toBe(false)
    expect(contents.removeListener).toHaveBeenCalledWith('did-finish-load', handler)
  })

  it('does nothing for a window that never closes', () => {
    const contents = fakeWebContents()
    setDidFinishLoadHandler(vi.fn(), contents)

    clearDidFinishLoadHandlerOnWindowClosed(destroyedWindow(), contents)

    expect(didFinishLoadHandlersByWebContents.has(contents)).toBe(true)
    didFinishLoadHandlersByWebContents.delete(contents)
  })

  it('tolerates a window object with no once, which the optional call already allowed', () => {
    expect(() => clearDidFinishLoadHandlerOnWindowClosed({}, fakeWebContents())).not.toThrow()
  })
})
