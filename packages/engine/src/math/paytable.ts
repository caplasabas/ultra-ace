import { SymbolKind } from '../types/symbol.js'

export const PAYTABLE: Record<SymbolKind, number[]> = {
  A: [0, 0, 0.3, 0.9, 1.5],
  K: [0, 0, 0.24, 0.72, 1.2],
  Q: [0, 0, 0.18, 0.54, 0.9],
  J: [0, 0, 0.12, 0.36, 0.6],

  // Low symbols
  SPADE: [0, 0, 0.06, 0.18, 0.3],
  HEART: [0, 0, 0.06, 0.18, 0.3],
  DIAMOND: [0, 0, 0.03, 0.09, 0.15],
  CLUB: [0, 0, 0.03, 0.09, 0.15],

  // Non-paying symbols
  WILD: [0, 0, 0, 0, 0],
  SCATTER: [0, 0, 0, 0, 0],
  EMPTY: [0, 0, 0, 0, 0],
}
