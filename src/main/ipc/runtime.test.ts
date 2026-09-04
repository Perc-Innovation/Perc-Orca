import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  onMock,
  removeAllListenersMock,
  removeHandlerMock,
  getMainWindowForWebContentsMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  onMock: vi.fn(),
  removeAllListenersMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  getMainWindowForWebContentsMock: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    on: onMock,
    removeAllListeners: removeAllListenersMock,
    removeHandler: removeHandlerMock
  }
}))

vi.mock('../window/main-window-registry', () => ({
  getMainWindowForWebContents: getMainWindowForWebContentsMock
}))

import { registerRuntimeHandlers } from './runtime'
import { TERMINAL_FIT_RESTORE_DEADLINE_MS } from '../../shared/terminal-fit-restore-deadline'

function getRegisteredHandler(channel: string) {
  const registration = handleMock.mock.calls.find(([name]) => name === channel)
  expect(registration).toBeTruthy()
  return registration![1]
}

function runtimeCallEvent() {
  const mainFrame = {}
  return {
    sender: {
      id: 1,
      mainFrame,
      on: vi.fn(),
      once: vi.fn()
    },
    senderFrame: mainFrame
  }
}

describe('registerRuntimeHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset()
    onMock.mockReset()
    removeAllListenersMock.mockReset()
    removeHandlerMock.mockReset()
    getMainWindowForWebContentsMock.mockReset()
  })

  it('routes sync requests through the authoritative browser window id', () => {
    const runtime = {
      syncWindowGraph: vi.fn().mockReturnValue({ graphStatus: 'ready' }),
      getStatus: vi.fn().mockReturnValue({ graphStatus: 'unavailable' }),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1')
    }

    registerRuntimeHandlers(runtime as never)

    const syncRegistration = handleMock.mock.calls.find(
      ([channel]) => channel === 'runtime:syncWindowGraph'
    )
    expect(syncRegistration).toBeTruthy()

    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })

    const currentMainFrame = {}
    const sender = { mainFrame: currentMainFrame }
    const handler = syncRegistration![1]
    const graph = { tabs: [], leaves: [], rendererGeneration: 'renderer-1' }
    const result = handler({ sender, senderFrame: currentMainFrame }, graph)

    expect(runtime.syncWindowGraph).toHaveBeenCalledWith(17, graph)
    expect(result).toEqual({ graphStatus: 'ready' })
  })

  it('rejects a graph publication queued by a superseded main frame', () => {
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      getRuntimeId: vi.fn()
    }
    registerRuntimeHandlers(runtime as never)
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'runtime:syncWindowGraph'
    )![1]
    const sender = { mainFrame: { generation: 2 } }
    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })

    expect(() =>
      handler({ sender, senderFrame: { generation: 1 } }, { tabs: [], leaves: [] })
    ).toThrow('Runtime graph sync must originate from the current main frame')
    expect(runtime.syncWindowGraph).not.toHaveBeenCalled()
  })

  it('rejects graph publications without a renderer generation', () => {
    const runtime = { syncWindowGraph: vi.fn() }
    registerRuntimeHandlers(runtime as never)
    const handler = handleMock.mock.calls.find(
      ([channel]) => channel === 'runtime:syncWindowGraph'
    )![1]
    const currentMainFrame = {}
    const sender = { mainFrame: currentMainFrame }
    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })

    expect(() =>
      handler({ sender, senderFrame: currentMainFrame }, { tabs: [], leaves: [] })
    ).toThrow('Runtime graph sync requires a renderer generation')
    expect(runtime.syncWindowGraph).not.toHaveBeenCalled()
  })

  it('routes generic local runtime RPC calls through the dispatcher', async () => {
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn().mockReturnValue({
        runtimeId: 'runtime-1',
        rendererGraphEpoch: 0,
        graphStatus: 'ready',
        authoritativeWindowId: null,
        liveTabCount: 0,
        liveLeafCount: 0
      }),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1')
    }

    registerRuntimeHandlers(runtime as never)

    const callRegistration = handleMock.mock.calls.find(([channel]) => channel === 'runtime:call')
    expect(callRegistration).toBeTruthy()

    const handler = callRegistration![1]
    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })
    const result = await handler(runtimeCallEvent(), { method: 'status.get' })

    expect(result).toMatchObject({
      ok: true,
      result: { runtimeId: 'runtime-1', graphStatus: 'ready' },
      _meta: { runtimeId: 'runtime-1' }
    })
  })

  it('registers project group runtime RPC methods for local desktop callers', async () => {
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1'),
      listProjectGroups: vi.fn().mockReturnValue([{ id: 'group-1', name: 'Platform' }])
    }

    registerRuntimeHandlers(runtime as never)

    const callRegistration = handleMock.mock.calls.find(([channel]) => channel === 'runtime:call')
    expect(callRegistration).toBeTruthy()

    const handler = callRegistration![1]
    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })
    const result = await handler(runtimeCallEvent(), { method: 'projectGroup.list' })

    expect(result).toMatchObject({
      ok: true,
      result: { groups: [{ id: 'group-1', name: 'Platform' }] },
      _meta: { runtimeId: 'runtime-1' }
    })
  })

  it('registers local runtime streaming subscription lifecycle handlers', () => {
    registerRuntimeHandlers({ syncWindowGraph: vi.fn(), getStatus: vi.fn() } as never)

    expect(handleMock.mock.calls.some(([channel]) => channel === 'runtime:subscribe')).toBe(true)
    expect(onMock.mock.calls.some(([channel]) => channel === 'runtime:unsubscribe')).toBe(true)
    expect(removeAllListenersMock).toHaveBeenCalledWith('runtime:unsubscribe')
  })

  it('deduplicates retries while a terminal fit restore is still pending', async () => {
    const finishRestoreByPtyId = new Map<string, (restored: boolean) => void>()
    const reclaimTerminalForDesktop = vi.fn(
      (ptyId: string) =>
        new Promise<boolean>((resolve) => {
          finishRestoreByPtyId.set(ptyId, resolve)
        })
    )
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      reclaimTerminalForDesktop,
      resolveOwnerWindowIdForPtyId: vi.fn(() => 17)
    }
    registerRuntimeHandlers(runtime as never)
    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })
    const restoreRegistration = handleMock.mock.calls.find(
      ([channel]) => channel === 'runtime:restoreTerminalFit'
    )
    expect(restoreRegistration).toBeTruthy()
    const handler = restoreRegistration![1]

    const first = handler({ sender: {} }, { ptyId: 'pty-1' })
    const retry = handler({ sender: {} }, { ptyId: 'pty-1' })
    const otherTerminal = handler({ sender: {} }, { ptyId: 'pty-2' })

    expect(reclaimTerminalForDesktop).toHaveBeenCalledTimes(2)
    expect(reclaimTerminalForDesktop).toHaveBeenNthCalledWith(1, 'pty-1')
    expect(reclaimTerminalForDesktop).toHaveBeenNthCalledWith(2, 'pty-2')
    finishRestoreByPtyId.get('pty-1')?.(true)
    finishRestoreByPtyId.get('pty-2')?.(true)
    await expect(otherTerminal).resolves.toEqual({ restored: true })
    await expect(first).resolves.toEqual({ restored: true })
    await expect(retry).resolves.toEqual({ restored: true })
    expect(reclaimTerminalForDesktop).toHaveBeenCalledTimes(2)

    const afterSettlement = handler({ sender: {} }, { ptyId: 'pty-1' })
    expect(reclaimTerminalForDesktop).toHaveBeenCalledTimes(3)
    finishRestoreByPtyId.get('pty-1')?.(false)
    await expect(afterSettlement).resolves.toEqual({ restored: false })
  })

  it('bounds retries without accumulating reclaim waiters for one PTY', async () => {
    vi.useFakeTimers()
    try {
      let finishRestore!: (restored: boolean) => void
      const reclaimTerminalForDesktop = vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            finishRestore = resolve
          })
      )
      registerRuntimeHandlers({
        syncWindowGraph: vi.fn(),
        getStatus: vi.fn(),
        reclaimTerminalForDesktop,
        resolveOwnerWindowIdForPtyId: vi.fn(() => 17)
      } as never)
      getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })
      const handler = handleMock.mock.calls.find(
        ([channel]) => channel === 'runtime:restoreTerminalFit'
      )![1]

      const first = handler({ sender: {} }, { ptyId: 'pty-wedged' })
      await vi.advanceTimersByTimeAsync(TERMINAL_FIT_RESTORE_DEADLINE_MS)
      await expect(first).resolves.toEqual({ restored: false })

      const retry = handler({ sender: {} }, { ptyId: 'pty-wedged' })
      expect(reclaimTerminalForDesktop).toHaveBeenCalledTimes(1)
      finishRestore(true)
      await expect(retry).resolves.toEqual({ restored: true })

      const afterSettlement = handler({ sender: {} }, { ptyId: 'pty-wedged' })
      expect(reclaimTerminalForDesktop).toHaveBeenCalledTimes(2)
      finishRestore(false)
      await expect(afterSettlement).resolves.toEqual({ restored: false })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects generic local runtime RPC calls from unregistered senders', async () => {
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1')
    }

    registerRuntimeHandlers(runtime as never)

    await expect(
      getRegisteredHandler('runtime:call')({ sender: {} }, { method: 'status.get' })
    ).rejects.toThrow('Runtime IPC calls must originate from a BrowserWindow')
  })

  it('scopes direct runtime hydration snapshots to the sender window owner graph', () => {
    const sender = {}
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1'),
      getAllTerminalFitOverrides: vi.fn().mockReturnValue(
        new Map([
          ['pty-owned', { mode: 'mobile-fit', cols: 100, rows: 40 }],
          ['pty-other', { mode: 'mobile-fit', cols: 80, rows: 24 }]
        ])
      ),
      getAllTerminalDrivers: vi.fn().mockReturnValue(
        new Map([
          ['pty-owned', { kind: 'mobile', clientId: 'phone-owned' }],
          ['pty-other', { kind: 'mobile', clientId: 'phone-other' }]
        ])
      ),
      getAllBrowserDrivers: vi.fn().mockReturnValue(
        new Map([
          ['browser-owned', { kind: 'mobile', clientId: 'phone-owned' }],
          ['browser-other', { kind: 'mobile', clientId: 'phone-other' }]
        ])
      ),
      resolveOwnerWindowIdForPtyId: vi.fn((ptyId: string) => (ptyId === 'pty-owned' ? 17 : 23)),
      resolveOwnerWindowIdForBrowserPageId: vi.fn((pageId: string) =>
        pageId === 'browser-owned' ? 17 : 23
      )
    }

    registerRuntimeHandlers(runtime as never)
    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })

    expect(getRegisteredHandler('runtime:getTerminalFitOverrides')({ sender })).toEqual([
      { ptyId: 'pty-owned', mode: 'mobile-fit', cols: 100, rows: 40 }
    ])
    expect(getRegisteredHandler('runtime:getTerminalDrivers')({ sender })).toEqual([
      { ptyId: 'pty-owned', driver: { kind: 'mobile', clientId: 'phone-owned' } }
    ])
    expect(getRegisteredHandler('runtime:getBrowserDrivers')({ sender })).toEqual([
      {
        browserPageId: 'browser-owned',
        driver: { kind: 'mobile', clientId: 'phone-owned' }
      }
    ])
  })

  it('fails direct desktop reclaim IPC closed for non-owner windows', async () => {
    const sender = {}
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1'),
      resolveOwnerWindowIdForPtyId: vi.fn(() => 23),
      resolveOwnerWindowIdForBrowserPageId: vi.fn(() => 23),
      reclaimTerminalForDesktop: vi.fn().mockResolvedValue(true),
      reclaimBrowserForDesktop: vi.fn().mockReturnValue(true)
    }

    registerRuntimeHandlers(runtime as never)
    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })

    await expect(
      getRegisteredHandler('runtime:restoreTerminalFit')({ sender }, { ptyId: 'pty-other' })
    ).resolves.toEqual({ restored: false })
    expect(
      getRegisteredHandler('runtime:reclaimBrowserForDesktop')(
        { sender },
        { browserPageId: 'browser-other' }
      )
    ).toEqual({ reclaimed: false })
    expect(runtime.reclaimTerminalForDesktop).not.toHaveBeenCalled()
    expect(runtime.reclaimBrowserForDesktop).not.toHaveBeenCalled()
  })

  it('allows direct desktop reclaim IPC for the owning window', async () => {
    const sender = {}
    const runtime = {
      syncWindowGraph: vi.fn(),
      getStatus: vi.fn(),
      getRuntimeId: vi.fn().mockReturnValue('runtime-1'),
      resolveOwnerWindowIdForPtyId: vi.fn(() => 17),
      resolveOwnerWindowIdForBrowserPageId: vi.fn(() => 17),
      reclaimTerminalForDesktop: vi.fn().mockResolvedValue(true),
      reclaimBrowserForDesktop: vi.fn().mockReturnValue(true)
    }

    registerRuntimeHandlers(runtime as never)
    getMainWindowForWebContentsMock.mockReturnValue({ id: 17 })

    await expect(
      getRegisteredHandler('runtime:restoreTerminalFit')({ sender }, { ptyId: 'pty-owned' })
    ).resolves.toEqual({ restored: true })
    expect(
      getRegisteredHandler('runtime:reclaimBrowserForDesktop')(
        { sender },
        { browserPageId: 'browser-owned' }
      )
    ).toEqual({ reclaimed: true })
    expect(runtime.reclaimTerminalForDesktop).toHaveBeenCalledWith('pty-owned')
    expect(runtime.reclaimBrowserForDesktop).toHaveBeenCalledWith('browser-owned')
  })
})
