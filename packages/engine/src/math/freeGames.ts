import { spin } from '../spin'
import { PRNG } from '../rng'

export function playFreeGames(
  rng: PRNG,
  spins: number,
  betPerLine: number,
  lines: number
): number {

  let totalWin = 0

  for (let i = 0; i < spins; i++) {
    const result = spin(rng, {
      betPerLine,
      lines,
      isFreeGame: true,
    })

    // 1.5x Super Ace–style multiplier
    totalWin += result.win * 1.5
  }

  return totalWin
}
