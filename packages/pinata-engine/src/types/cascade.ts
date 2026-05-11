// src/types/cascade.ts
import { Symbol } from './symbol.js'

export interface LineWin {
  symbol: string
  lineIndex?: number
  payline?: number[]
  count: number
  payout: number
  positions: { reel: number; row: number }[]
}

export interface CascadeStep {
  index: number
  multiplier: number
  goldMultiplier?: number
  lineWins: LineWin[]
  win: number
  isScatterTerminal?: boolean
  removedPositions: { reel: number; row: number }[]
  window: Symbol[][]
}
