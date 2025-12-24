import { Symbol } from './symbol.js'

export interface RowWin {
  row: number
  symbol: string
  count: number
  payout: number
  positions: { reel: number; row: number }[]
}

export interface CascadeStep {
  index: number
  multiplier: number
  rowWins: RowWin[]
  win: number
  removedPositions: { reel: number; row: number }[]
  window: Symbol[][]
}
