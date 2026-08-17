import type { DshApi } from './index'

declare global {
  interface Window {
    dsh: DshApi
  }
}

export {}
