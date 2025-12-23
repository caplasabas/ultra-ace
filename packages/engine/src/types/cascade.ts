// /types/cascade.ts
import { Symbol } from './symbol.js'

export interface LineWin {
  symbol: string
  count: number
  payout: number
  positions: { reel: number; row: number }[]
}

export interface CascadeStep {
  index: number
  multiplier: number
  lineWins: LineWin[]
  win: number
  removedPositions: { reel: number; row: number }[]
  window: Symbol[][]
}
