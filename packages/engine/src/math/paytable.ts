// src/math/paytable.ts
import { SymbolKind } from '../types/symbol.js'

export const PAYTABLE: Record<SymbolKind, number[]> = {
  A: [0, 2, 30, 120, 300],
  K: [0, 1.6, 25, 100, 250],
  Q: [0, 1.4, 20, 80, 200],
  J: [0, 1.2, 15, 60, 150],

  SPADE: [0, 0.6, 2, 5, 15],
  HEART: [0, 0.6, 2, 5, 15],
  DIAMOND: [0, 0.8, 2.5, 6, 18],
  CLUB: [0, 0.8, 2.5, 6, 18],

  WILD: [0, 0, 0, 0, 0],
  SCATTER: [0, 0, 0, 0, 0],
  EMPTY: [0, 0, 0, 0, 0],
}
