// src/math/paytable.ts
import { SymbolKind } from '../types/symbol'

export const PAYTABLE: Record<SymbolKind, number[]> = {
  A: [0, 0, 30, 120, 600],
  K: [0, 0, 25, 100, 500],
  Q: [0, 0, 20, 80, 400],
  J: [0, 0, 15, 60, 300],

  SPADE: [0, 0, 0, 0, 0],
  HEART: [0, 0, 0, 0, 0],
  DIAMOND: [0, 0, 0, 0, 0],
  CLUB: [0, 0, 0, 0, 0],

  WILD: [0, 0, 0, 0, 0],
  SCATTER: [0, 0, 0, 0, 0],
}
