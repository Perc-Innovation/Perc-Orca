import { ipcRenderer } from 'electron'
import type { WindowScopeChangedPayload } from '../../shared/window-scope'
import type { PreloadApi } from '../api-types'

/** Multi-window: a window's project scope, the terminal rescue, and the close handshake. */
export const uiWindowScopeApi = {
  getWindowScope: () => ipcRenderer.invoke('ui:getWindowScope'),
  openProjectGroupWindow: (args) => ipcRenderer.invoke('ui:openProjectGroupWindow', args),
  setWindowScope: (args) => ipcRenderer.invoke('ui:setWindowScope', args),
  setWindowScopeLabel: (label) => ipcRenderer.send('ui:setWindowScopeLabel', label),
  onWindowScopeChanged: (callback: (payload: WindowScopeChangedPayload) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: WindowScopeChangedPayload
    ): void => callback(payload)
    ipcRenderer.on('ui:windowScopeChanged', listener)
    return () => ipcRenderer.removeListener('ui:windowScopeChanged', listener)
  },
  /** Window > Recover Terminal: user-invoked rescue for a pane that stopped taking input. */
  onRecoverTerminal: (callback: () => void): (() => void) => {
    const listener = () => callback()
    ipcRenderer.on('ui:recoverTerminal', listener)
    return () => ipcRenderer.removeListener('ui:recoverTerminal', listener)
  },
  /** Tell the main process that renderer-side close confirmation was canceled. */
  cancelWindowClose: (): void => {
    ipcRenderer.send('window:cancel-close')
  }
} satisfies Partial<PreloadApi['ui']>
