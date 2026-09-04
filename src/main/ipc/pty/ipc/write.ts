import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { getPtyIpc } from '../../pty-host-bindings'
import type { OrcaRuntimeService } from '../../../runtime/orca-runtime'
import { getMainWindowForWebContents } from '../../../window/main-window-registry'
import { revealHiddenRendererPtyOnInput } from '../delivery/hidden-gate-input-veto'
import { resolveRendererPtyClaimWindowId } from '../delivery/renderer-pty-window-claims'
import type { PtyIpcSession } from '../session'
import { createPtyWriteInput } from './write-input'

export function installPtyWriteIpcHandlers(deps: {
  mainWindow: BrowserWindow
  runtime?: OrcaRuntimeService
  clearHiddenRendererResizeOutput: (id: string) => void
  session: PtyIpcSession
}): void {
  const ipcMain = getPtyIpc()
  const { runtime, session } = deps
  const {
    writePtyInput,
    writePtyInputAccepted,
    isPtyWritePayload,
    isPtyViewportClaimPayload,
    isPtyWriteEventFromMainWindow
  } = createPtyWriteInput(deps)

  // Why before the write: the keystroke is the proof this window is looking at the pane, and
  // the bytes it provokes must not be dropped under a hidden mark the renderer failed to clear.
  const vetoHiddenGateForSender = (
    event: IpcMainEvent | IpcMainInvokeEvent,
    ptyId: string
  ): void => {
    const senderWindow = getMainWindowForWebContents(event.sender)
    revealHiddenRendererPtyOnInput(session, ptyId, resolveRendererPtyClaimWindowId(senderWindow))
  }

  const hostViewportClaimTails = new Map<string, Promise<boolean>>()

  ipcMain.on('pty:write', (event, args: unknown) => {
    if (!isPtyWriteEventFromMainWindow(event) || !isPtyWritePayload(args)) {
      return
    }
    vetoHiddenGateForSender(event, args.id)
    const claimTail = hostViewportClaimTails.get(args.id)
    if (claimTail) {
      void claimTail.then((claimed) => (claimed ? writePtyInput(args) : false))
      return
    }
    writePtyInput(args)
  })
  ipcMain.handle('pty:writeAccepted', (event, args: unknown): boolean | Promise<boolean> => {
    if (!isPtyWriteEventFromMainWindow(event) || !isPtyWritePayload(args)) {
      return false
    }
    vetoHiddenGateForSender(event, args.id)
    const claimTail = hostViewportClaimTails.get(args.id)
    return claimTail
      ? claimTail.then((claimed) => (claimed ? writePtyInputAccepted(args) : false))
      : writePtyInputAccepted(args)
  })

  ipcMain.removeAllListeners('pty:claimViewport')
  ipcMain.on('pty:claimViewport', (event, args: unknown) => {
    if (!isPtyWriteEventFromMainWindow(event) || !runtime || !isPtyViewportClaimPayload(args)) {
      return
    }
    const prior = hostViewportClaimTails.get(args.id)
    // Why: two panes can mirror one PTY — never let a later no-op claim replace the in-flight resize that the following host input must await.
    const claim = (
      prior
        ? prior.then(
            () => runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows),
            () => runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows)
          )
        : runtime.claimRemoteDesktopHost(args.id, args.cols, args.rows)
    ).catch((error) => {
      // Why: a failed claim silently discards every gated keystroke for this pane.
      console.error('[pty] remote desktop host claim failed; gated input will be discarded', error)
      return false
    })
    hostViewportClaimTails.set(args.id, claim)
    void claim.then(() => {
      if (hostViewportClaimTails.get(args.id) === claim) {
        hostViewportClaimTails.delete(args.id)
      }
    })
  })
}
