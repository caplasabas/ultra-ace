// src/types/spin.ts

import { CascadeStep } from './cascade.js'

export interface SpinInput {
  betPerSpin: number // TOTAL bet (e.g. 20)
  lines: number
  isFreeGame?: boolean
}

export interface SpinOutcome {
  bet: number // total bet charged
  win: number // total win
  reelStops: number[]
  cascades?: CascadeStep[]
}
