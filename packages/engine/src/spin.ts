import { PRNG } from './rng.js'
import { REELS } from './math/reels.js'
import { REELS_FREE } from './math/reels.free.js'
import { runCascades } from './math/cascade.js'
import { SpinInput, SpinOutcome } from './types/spin.js'
import { GAME_CONFIG } from './config/game.config.js'
import type { Symbol } from './types/symbol.js'

const GOLD_CHANCE_INITIAL = 0.04
const GOLD_TTL = 2
const FORBIDDEN_GOLD_REELS = new Set([0, 4])

export function spin(rng: PRNG, input: SpinInput): SpinOutcome {
  const isFreeGame = Boolean(input.isFreeGame)
  const totalBet = input.isFreeGame ? 0 : input.betPerSpin

  const reels = input.isFreeGame ? REELS_FREE : REELS

  const stops = reels.map(reel => Math.floor(rng() * reel.length))

  const window: Symbol[][] = reels.map((reel, reelIndex) =>
    Array.from({ length: GAME_CONFIG.reelsVisibleRows }, (_, row) => {
      const idx = (stops[reelIndex] + row) % reel.length
      let symbol = reel[idx]

      if (
        !FORBIDDEN_GOLD_REELS.has(reelIndex) &&
        symbol.kind !== 'SCATTER' &&
        Math.random() < GOLD_CHANCE_INITIAL
      ) {
        symbol = { ...symbol, isGold: true, goldTTL: GOLD_TTL }
      }

      return symbol
    }),
  )

  const scatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

  // scatterCount = isFreeGame ? scatterCount : 3
  // // 🔧 DEV: force scatter for faster testing
  // if (!isFreeGame && GAME_CONFIG.devForceScatterChance > 0) {
  //   if (Math.random() < GAME_CONFIG.devForceScatterChance) {
  //     // force minimum trigger
  //     scatterCount = Math.max(scatterCount, 3)
  //   }
  // }

  const { totalWin, cascades } = runCascades(window, input.betPerSpin, isFreeGame)

  const freeSpinsAwarded = !isFreeGame && scatterCount >= 3 ? GAME_CONFIG.freeSpinsAwarded : 0
  return {
    bet: totalBet,
    win: totalWin,
    reelStops: stops,
    cascades,
    scatterCount,
    freeSpinsAwarded,
  }
}
