// src/math/paytable.ts
import { SymbolKind } from '../types/symbol'

export const PAYTABLE: Record<SymbolKind, number[]> = {
  A: [0, 5, 30, 120, 600],
  K: [0, 4, 25, 100, 500],
  Q: [0, 3, 20, 80, 400],
  J: [0, 2, 15, 60, 300],

  SPADE: [0, 0, 2, 5, 15],
  HEART: [0, 0, 2, 5, 15],
  DIAMOND: [0, 0, 3, 6, 18],
  CLUB: [0, 0, 3, 6, 18],

  WILD: [0, 0, 0, 0, 0],
  SCATTER: [0, 0, 0, 0, 0],
  EMPTY: [0, 0, 0, 0, 0],
}
