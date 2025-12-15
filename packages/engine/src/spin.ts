import { PRNG } from './rng'
import { REELS } from './math/reels'
import { runCascades } from './math/cascade'
import { seedInitialWindow } from './math/seed'
import { SpinInput, SpinOutcome } from './types/spin'
import { GAME_CONFIG } from './config/game.config'

export function spin(rng: PRNG, input: SpinInput): SpinOutcome {
  const activeLines = Math.min(input.lines, GAME_CONFIG.maxLines)

  const totalBet = input.isFreeGame ? 0 : input.betPerSpin
  const betPerLine = input.isFreeGame ? 0 : input.betPerSpin / activeLines

  const stops = REELS.map(reel => Math.floor(rng() * reel.length))

  const window = REELS.map((reel, i) =>
    Array.from({ length: GAME_CONFIG.reelsVisibleRows }, (_, row) => {
      const idx = (stops[i] + row) % reel.length
      return reel[idx]
    }),
  )

  seedInitialWindow(window, rng, activeLines)

  const { totalWin, cascades } = runCascades(window, betPerLine, activeLines)

  return {
    bet: totalBet,
    win: totalWin,
    reelStops: stops,
    cascades,
  }
}
