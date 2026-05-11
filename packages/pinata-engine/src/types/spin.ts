import { CascadeStep } from './cascade.js'

export interface SpinInput {
  betPerSpin: number
  lines: number
  isFreeGame?: boolean
  forceScatter?: boolean
  freeSpinSource?: 'natural' | 'buy'
  freeSpinGlobalMultiplier?: number
}

export interface SpinOutcome {
  bet: number
  baseWin: number
  win: number
  collectedMultiplier: number
  finalMultiplier: number
  freeSpinGlobalMultiplierBefore?: number
  freeSpinGlobalMultiplierAfter?: number
  reelStops: number[]
  cascades: CascadeStep[]

  scatterCount: number
  freeSpinsAwarded: number

  scatterTriggerType?: 'natural' | 'buy'
}
