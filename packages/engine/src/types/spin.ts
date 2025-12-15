// src/types/spin.ts

import { Symbol } from './symbol'

export interface LineWin {
  lineIndex: number
  symbol: Symbol['kind']
  count: number
  payout: number
  positions: { reel: number; row: number }[]
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
