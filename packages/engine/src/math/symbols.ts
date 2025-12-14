// src/math/paytable.ts
import { LineSymbol } from '../types/symbol'

export const PAYTABLE: Record<LineSymbol, number[]> = {
  // index = match count (0–5)
  A: [0, 0, 20, 80, 300],
  K: [0, 0, 15, 60, 220],
  Q: [0, 0, 12, 45, 160],
  J: [0, 0, 10, 35, 120],
  '10': [0, 0, 8, 25, 90],
  '9': [0, 0, 6, 20, 70],
  LOW: [0, 0, 4, 12, 40],
  WILD: [0, 0, 0, 0, 0],
}
