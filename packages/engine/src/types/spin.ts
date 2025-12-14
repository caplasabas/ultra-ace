import { Symbol } from './symbol'

export interface SpinResult {
  window: Symbol[][]
  win: number
}

export interface LineWin {
  lineIndex: number
  symbol: Symbol
  count: number
  payout: number
}

export interface SpinOutcome {
  bet: number
  win: number
  reelStops: number[]
  lineWins: {
    lineIndex: number
    symbol: Symbol
    count: number
    payout: number
    positions: { reel: number; row: number }[]
  }[]
}

export interface SpinInput {
  betPerLine: number
  lines: number
  isFreeGame?: boolean
}
