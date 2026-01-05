import { CascadeStep } from './cascade.js'

export interface SpinInput {
  betPerSpin: number
  lines: number
  isFreeGame?: boolean
  forceScatter?: boolean
}

export interface SpinOutcome {
  bet: number
  win: number
  reelStops: number[]
  cascades: CascadeStep[]

  scatterCount: number
  freeSpinsAwarded: number

  scatterTriggerType?: 'natural' | 'buy'
}
