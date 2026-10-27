export type Usage = {
  percent: number | null
  tokens: number | null
  window: number
  costUsd: number | null
  limits: { kind: string; percentUsed: number; resetsAt?: string }[]
}

export type Summary = { text: string; at: number; turns: number }

declare module 'claude-code' {
  interface PluginState {
    'chat-room': {
      usage: Shaped<Usage | null>
      summary: Shaped<Summary | null>
      busy: string | null
      isBandHidden: boolean
    }
  }
}
