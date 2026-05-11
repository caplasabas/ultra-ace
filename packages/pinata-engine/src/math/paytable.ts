import { SymbolKind } from '../types/symbol.js'

export const PAYTABLE: Record<SymbolKind, number[]> = {
  SKULL: [0, 0, 5, 25, 100],
  SOMBRERO: [0, 0, 2, 10, 40],
  MARACAS: [0, 0, 1.5, 5, 20],
  TACO: [0, 0, 1, 4, 15],
  CHILLI: [0, 0, 0.5, 2, 10],
  A: [0, 0, 0.2, 1, 5],
  K: [0, 0, 0.2, 1, 5],
  Q: [0, 0, 0.2, 1, 5],
  J: [0, 0, 0.2, 1, 5],
  WILD: [0, 0, 0, 0, 0],
  SCATTER: [0, 0, 0, 0, 0],
  EMPTY: [0, 0, 0, 0, 0],
}
