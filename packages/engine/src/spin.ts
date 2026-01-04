import { PRNG } from './rng.js'
import { REELS } from './math/reels.js'
import { REELS_FREE } from './math/reels.free.js'
import { runCascades } from './math/cascade.js'
import { SpinInput, SpinOutcome } from './types/spin.js'
import { GAME_CONFIG } from './config/game.config.js'
import { DEV_FORCE_FREE_RETRIGGER } from './config/wild.config.js'
import type { Symbol } from './types/symbol.js'

const GOLD_CHANCE_INITIAL = 0.02
const GOLD_TTL = 0
const FORBIDDEN_GOLD_REELS = new Set([0, 4])

export function spin(rng: PRNG, input: SpinInput): SpinOutcome {
  const isFreeGame = Boolean(input.isFreeGame)
  const totalBet = isFreeGame ? 0 : input.betPerSpin

  const reels = isFreeGame ? REELS_FREE : REELS
  const stops = reels.map(reel => Math.floor(rng() * reel.length))

  const window: Symbol[][] = reels.map((reel, reelIndex) =>
    Array.from({ length: GAME_CONFIG.reelsVisibleRows }, (_, row) => {
      const idx = (stops[reelIndex] + row) % reel.length

      // 🔒 ALWAYS CLONE (critical)
      const symbol: Symbol = { ...reel[idx] }

      if (
        !FORBIDDEN_GOLD_REELS.has(reelIndex) &&
        symbol.kind !== 'SCATTER' &&
        rng() < GOLD_CHANCE_INITIAL
      ) {
        symbol.isGold = true
        symbol.goldTTL = GOLD_TTL
      }

      return symbol
    }),
  )

  const scatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

  const { totalWin, cascades } = runCascades(
    window,
    input.betPerSpin,
    isFreeGame,
    rng, // 🔑 pass RNG
  )

  let freeSpinsAwarded = !isFreeGame && scatterCount >= 3 ? GAME_CONFIG.freeSpinsAwarded : 0

  if (isFreeGame && (scatterCount >= 3 || DEV_FORCE_FREE_RETRIGGER)) {
    freeSpinsAwarded += 5
  }

  return {
    bet: totalBet,
    win: totalWin,
    reelStops: stops,
    cascades,
    scatterCount,
    freeSpinsAwarded,
  }
}
