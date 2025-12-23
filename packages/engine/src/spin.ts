import { PRNG } from './rng.js'
import { REELS } from './math/reels.js'
import { runCascades } from './math/cascade.js'
import { SpinInput, SpinOutcome } from './types/spin.js'
import { GAME_CONFIG } from './config/game.config.js'
import type { Symbol } from './types/symbol.js'

const GOLD_CHANCE_INITIAL = 0.04
const GOLD_TTL = 2

export function spin(rng: PRNG, input: SpinInput): SpinOutcome {
  const totalBet = input.isFreeGame ? 0 : input.betPerSpin

  const stops = REELS.map((reel: Symbol[]) => Math.floor(rng() * reel.length))

  const window: Symbol[][] = REELS.map((reel: Symbol[], i: number) =>
    Array.from({ length: GAME_CONFIG.reelsVisibleRows }, (_, row) => {
      const idx = (stops[i] + row) % reel.length
      let symbol = reel[idx]

      if (
        symbol.kind !== 'WILD' &&
        symbol.kind !== 'SCATTER' &&
        Math.random() < GOLD_CHANCE_INITIAL
      ) {
        symbol = {
          ...symbol,
          isGold: true,
          goldTTL: GOLD_TTL,
        }
      }

      return symbol
    }),
  )

  if (Math.random() < 0.04) {
    const r = Math.floor(Math.random() * window.length)
    const row = Math.floor(Math.random() * window[r].length)
    window[r][row] = { kind: 'WILD' }
  }

  const { totalWin, cascades } = runCascades(window, totalBet)

  return {
    bet: totalBet,
    win: totalWin,
    reelStops: stops,
    cascades,
  }
}
