import { LineSymbol } from '../types/symbol'

export const PAYTABLE: Record<LineSymbol, number[]> = {
  A:    [0, 0, 10, 30, 120],
  K:    [0, 0, 8, 25, 90],
  Q:    [0, 0, 10, 28, 80],
  J:    [0, 0, 8, 22, 65],
  '10': [0, 0, 7, 18, 55],
  '9':  [0, 0, 6, 15, 45],
  LOW:  [0, 0, 5, 16, 40],
  WILD: [0, 0, 0, 0, 0],
}
