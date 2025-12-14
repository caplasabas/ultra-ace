import { PRNG } from './rng'
import { REELS } from './math/reels'
import { PAYLINES } from './math/paylines'
import { evaluateSpin } from './math/evaluator'
import { SpinInput, SpinOutcome } from './types/spin'

import { GAME_CONFIG } from './config/game.config'

export function spin(rng: PRNG, input: SpinInput): SpinOutcome {
  const activeLines = Math.min(input.lines, PAYLINES.length)

  const reelStops = REELS.map(reel => Math.floor(rng() * reel.length))

  const result = evaluateSpin(
    reelStops,
    input.betPerLine,
    activeLines,
    GAME_CONFIG.reelsVisibleRows,
  )

  return {
    bet: input.isFreeGame ? 0 : input.betPerLine * activeLines,
    win: result.win,
    reelStops,
    lineWins: result.lineWins,
  }
}
