// src/utils/getWinningPositions.ts
import { PAYLINES } from '@constants/paylines'

export function getWinningPositions(winningPaylines: number[]) {
  const map = new Set<string>()

  winningPaylines.forEach(lineIndex => {
    PAYLINES[lineIndex].forEach((row, reelIndex) => {
      map.add(`${reelIndex}-${row}`)
    })
  })

  return map
}
