// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { OrcaRuntimeWithDeliverPendingMessages } from './orca-runtime-deliver-pending-messages'
import type { TerminalWaiter } from './runtime-terminal-contracts'
import type { RuntimeTerminalWait } from '../../shared/runtime-types'
import type { BrowserWindow } from 'electron'
import { getRuntimeDesktopSurface } from './runtime-desktop-surface'

export class OrcaRuntimeWithResolveWaiter extends OrcaRuntimeWithDeliverPendingMessages {
  protected resolveWaiter(waiter: TerminalWaiter, result: RuntimeTerminalWait): void {
    this.terminalWaiters.resolve(waiter, result)
  }

  protected rejectWaitersForHandle(handle: string, code: string): void {
    this.terminalWaiters.rejectHandle(handle, code)
  }

  protected rejectAllWaiters(code: string): void {
    this.terminalWaiters.rejectAll(code)
  }

  protected removeWaiter(waiter: TerminalWaiter): void {
    this.terminalWaiters.remove(waiter)
  }

  protected getLeafKey(tabId: string, leafId: string): string {
    return `${tabId}::${leafId}`
  }

  protected getAuthoritativeWindow(): BrowserWindow {
    const win =
      this.getAvailableAuthoritativeWindow() ??
      getRuntimeDesktopSurface().findFocusedOrLastActiveWindow()
    if (!win || win.isDestroyed()) {
      throw new Error('No renderer window available')
    }
    return win
  }

  protected getAvailableAuthoritativeWindow(): BrowserWindow | null {
    if (this.authoritativeWindowId === null) {
      return null
    }
    const win = getRuntimeDesktopSurface().findWindowById(this.authoritativeWindowId)
    if (!win || win.isDestroyed()) {
      return null
    }
    // Why: an authoritative window can lose its webContents before `closed`
    // fires; a destroyed one cannot receive the relays callers are about to send.
    const webContentsDestroyed =
      typeof win.webContents?.isDestroyed === 'function' && win.webContents.isDestroyed()
    return webContentsDestroyed ? null : win
  }
}
