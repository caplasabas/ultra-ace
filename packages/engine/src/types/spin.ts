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
  lineWins: LineWin[]
}

export interface SpinInput {
  betPerLine: number
  lines: number
  isFreeGame?: boolean
}
