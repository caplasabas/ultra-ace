import { PRNG } from './rng'
import { REELS } from './math/reels'
import { PAYLINES } from './math/paylines'
import { evaluateSpin } from './math/evaluator'
import { SpinInput, SpinOutcome } from './types/spin'
import { playFreeGames } from './math/freeGames'

export function spin(
  rng: PRNG,
  input: SpinInput
): SpinOutcome {

  const activeLines = Math.min(input.lines, PAYLINES.length)

  const reelStops = REELS.map(
    reel => Math.floor(rng() * reel.length)
  )

  const { win, scatterCount, lineWins } = evaluateSpin(
    reelStops,
    input.betPerLine,
    activeLines,
    !!input.isFreeGame
  )

  let featureWin = 0
  if (!input.isFreeGame && scatterCount >= 3) {
    featureWin = playFreeGames(
      rng,
      10,
      input.betPerLine,
      activeLines
    )
  }

  return {
    bet: input.isFreeGame ? 0 : input.betPerLine * activeLines,
    win: win + featureWin,
    reelStops,
    lineWins,
  }
}
