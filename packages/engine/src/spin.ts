import { PRNG } from './rng.js'
import { REELS } from './math/reels.js'
import { runCascades } from './math/cascade.js'
import { SpinInput, SpinOutcome } from './types/spin.js'
import { GAME_CONFIG } from './config/game.config.js'

export function spin(rng: PRNG, input: SpinInput): SpinOutcome {
  const totalBet = input.isFreeGame ? 0 : input.betPerSpin

  const stops = REELS.map(reel => Math.floor(rng() * reel.length))

  const window = REELS.map((reel, i) =>
    Array.from({ length: GAME_CONFIG.reelsVisibleRows }, (_, row) => {
      const idx = (stops[i] + row) % reel.length
      return reel[idx]
    }),
  )

  // ✅ Slightly higher Wild activation chance
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
