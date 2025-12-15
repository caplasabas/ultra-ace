// src/math/paylines.ts

// Each number = row index per reel (top = 0)
export const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1], // middle
  [0, 0, 0, 0, 0], // top
  [2, 2, 2, 2, 2], // bottom

  [0, 1, 2, 1, 0], // V
  [2, 1, 0, 1, 2], // inverted V
]
