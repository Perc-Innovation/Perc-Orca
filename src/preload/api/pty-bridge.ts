import type { PreloadApi } from '../api-types'
import { ptySessionControlApi } from './pty-bridge-session-control'
import { ptyStreamAndSerializationApi } from './pty-bridge-stream-and-serialization'
import { ptyWindowOwnershipApi } from './pty-bridge-window-ownership'

export const ptyApi = {
  ...ptySessionControlApi,
  ...ptyStreamAndSerializationApi,
  ...ptyWindowOwnershipApi
} satisfies PreloadApi['pty']
