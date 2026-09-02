import { app, type BrowserWindow, type Event } from 'electron'
import { closeWindowAfterConfirmation, requestWindowCloseForQuit } from '../window/createMainWindow'
import { getMainWindows } from '../window/main-window-registry'
import { mainProcessState as state, type QuitConfirmationTransaction } from './main-process-state'
import { clearExpectedRendererReload } from './main-window-lifecycle-flags'

const QUIT_CONFIRMATION_TIMEOUT_MS = 30_000

/**
 * One Cmd+Q across several windows. Confirmations are collected first, then every window
 * closes, then app.quit() re-enters for will-quit — so a late veto from one window can never
 * leave another already destroyed. With the flag off this is the plain single-window quit.
 */

function cleanupQuitConfirmationTransaction(transaction: QuitConfirmationTransaction): void {
  clearTimeout(transaction.timeout)
  for (const cleanup of transaction.cleanupByWindowId.values()) {
    cleanup()
  }
  transaction.cleanupByWindowId.clear()
}

function finishQuitConfirmationTransaction(transaction: QuitConfirmationTransaction): void {
  cleanupQuitConfirmationTransaction(transaction)
  if (state.activeQuitConfirmationTransaction === transaction) {
    state.activeQuitConfirmationTransaction = null
  }
  app.quit()
}

export function abortQuitConfirmationTransaction(): void {
  const transaction = state.activeQuitConfirmationTransaction
  if (transaction) {
    cleanupQuitConfirmationTransaction(transaction)
  }
  state.activeQuitConfirmationTransaction = null
  state.quitConfirmedForAllWindows = false
  state.isQuitting = false
  clearExpectedRendererReload()
}

function completeQuitConfirmationTransaction(transaction: QuitConfirmationTransaction): void {
  if (state.activeQuitConfirmationTransaction !== transaction) {
    return
  }
  state.quitConfirmedForAllWindows = true
  transaction.phase = 'closing'
  clearTimeout(transaction.timeout)
  const liveParticipants = transaction.participants.filter((window) => !window.isDestroyed())
  transaction.pendingWindowIds = new Set(liveParticipants.map((window) => window.id))
  if (transaction.pendingWindowIds.size === 0) {
    finishQuitConfirmationTransaction(transaction)
    return
  }
  for (const window of liveParticipants) {
    if (!window.isDestroyed()) {
      closeWindowAfterConfirmation(window)
    }
  }
}

export function isQuitConfirmationCollecting(): boolean {
  return state.activeQuitConfirmationTransaction !== null
}

export function onQuitWindowCloseConfirmed(window: BrowserWindow): void {
  const transaction = state.activeQuitConfirmationTransaction
  if (!transaction) {
    return
  }
  transaction.pendingWindowIds.delete(window.id)
  if (transaction.pendingWindowIds.size === 0) {
    completeQuitConfirmationTransaction(transaction)
  }
}

/** Runs first in `before-quit`: sets isQuitting, and with several windows defers the quit until all accept. */
export function beginQuitConfirmationTransaction(event: Event): void {
  if (!state.experimentalMultiWindowEnabledAtStartup || state.quitConfirmedForAllWindows) {
    state.isQuitting = true
    return
  }
  event.preventDefault()
  if (state.activeQuitConfirmationTransaction) {
    return
  }

  const participants = getMainWindows()
  if (participants.length === 0) {
    state.quitConfirmedForAllWindows = true
    state.isQuitting = true
    app.quit()
    return
  }

  state.isQuitting = true
  const transaction: QuitConfirmationTransaction = {
    participants,
    pendingWindowIds: new Set(participants.map((window) => window.id)),
    cleanupByWindowId: new Map(),
    phase: 'confirming',
    timeout: setTimeout(() => {
      if (state.activeQuitConfirmationTransaction === transaction) {
        abortQuitConfirmationTransaction()
      }
    }, QUIT_CONFIRMATION_TIMEOUT_MS)
  }
  state.activeQuitConfirmationTransaction = transaction

  for (const window of participants) {
    const onClosed = (): void => {
      transaction.pendingWindowIds.delete(window.id)
      transaction.cleanupByWindowId.delete(window.id)
      if (transaction.pendingWindowIds.size === 0) {
        if (transaction.phase === 'closing') {
          finishQuitConfirmationTransaction(transaction)
        } else {
          completeQuitConfirmationTransaction(transaction)
        }
      }
    }
    window.once('closed', onClosed)
    transaction.cleanupByWindowId.set(window.id, () => window.removeListener('closed', onClosed))
    if (!requestWindowCloseForQuit(window)) {
      onQuitWindowCloseConfirmed(window)
    }
  }
}
