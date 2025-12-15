import { Symbol } from './symbol'

export interface LineWin {
  lineIndex: number
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
