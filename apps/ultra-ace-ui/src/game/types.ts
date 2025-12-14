import type { SpinOutcome } from '@ultra-ace/engine'

export interface VisualReel {
  symbols: string[] // full reel strip (debug / future)
  stopIndex: number // debug
  visible: string[] // ALWAYS length === VISIBLE_ROWS
}

export interface VisualSpinResult {
  reels: VisualReel[]
  outcome: SpinOutcome
  winningPaylines: number[]
  debug: DebugSpinInfo
}

export type VisualSpinBase = Omit<VisualSpinResult, 'debug'>

export interface DebugSpinInfo {
  seed: string
  reelStops: number[]
  bet: number
  win: number
}
