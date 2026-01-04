import { SymbolKind } from '../types/symbol.js'

export const PAYTABLE: Record<SymbolKind, number[]> = {
  A: [0, 0, 0.5, 1.5, 2.5],
  K: [0, 0, 0.4, 1.2, 2.0],
  Q: [0, 0, 0.3, 0.9, 1.5],
  J: [0, 0, 0.2, 0.6, 1.0],

  SPADE: [0, 0, 0.1, 0.3, 0.5],
  HEART: [0, 0, 0.1, 0.3, 0.5],
  DIAMOND: [0, 0, 0.05, 0.15, 0.25],
  CLUB: [0, 0, 0.05, 0.15, 0.25],

  WILD: [0, 0, 0, 0, 0],
  SCATTER: [0, 0, 0, 0, 0],
  EMPTY: [0, 0, 0, 0, 0],
}
