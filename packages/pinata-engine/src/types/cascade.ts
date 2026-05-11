// src/types/cascade.ts
import { Symbol } from './symbol.js'

export interface CollectedMultiplier {
  reel: number
  row: number
  value: number
  symbol: string
}

export interface RefillSymbol {
  reel: number
  row: number
  sourceRow: number
  symbol: Symbol
}

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
  baseWin?: number
  collectedMultiplier?: number
  collectedMultipliers?: CollectedMultiplier[]
  lineWins: LineWin[]
  win: number
  isScatterTerminal?: boolean
  removedPositions: { reel: number; row: number }[]
  refillSymbols?: RefillSymbol[]
  topPreview?: Symbol[][]
  window: Symbol[][]
}
