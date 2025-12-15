import type { SpinOutcome } from '@ultra-ace/engine'
export type UISymbol =
  | 'A'
  | 'K'
  | 'Q'
  | 'J'
  | 'SPADE'
  | 'HEART'
  | 'DIAMOND'
  | 'CLUB'
  | 'WILD'
  | 'SCATTER'
  | 'EMPTY'

export interface VisualReel {
  symbols: UISymbol[]
  stopIndex: number
}

export interface WinPosition {
  reel: number
  row: number
}

export interface VisualLineWin {
  lineIndex: number
  positions: WinPosition[]
}

export interface VisualSpinResult {
  reels: VisualReel[]
  outcome: SpinOutcome
  lineWins: VisualLineWin[]
  debug: DebugSpinInfo
}

export interface DebugSpinInfo {
  seed: string
  reelStops: number[]
  bet: number
  win: number
}
