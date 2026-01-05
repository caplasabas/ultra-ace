import { PRNG } from './rng.js'
import { REELS } from './math/reels.js'
import { REELS_FREE } from './math/reels.free.js'
import { runCascades } from './math/cascade.js'
import { SpinInput, SpinOutcome } from './types/spin.js'
import { GAME_CONFIG } from './config/game.config.js'
import { Symbol, SymbolKind } from './types/symbol.js'

const GOLD_CHANCE_INITIAL = 0.0015
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
      return { ...reel[idx] }
    }),
  )

  /* ----------------------------------------
     🎯 FORCE SCATTER (BUY FREE SPIN)
  ---------------------------------------- */
  if (input.forceScatter && !isFreeGame) {
    forceThreeScatters(window, rng)
  }

  /* ----------------------------------------
     GOLD ASSIGNMENT (unchanged)
  ---------------------------------------- */
  for (let reelIndex = 0; reelIndex < window.length; reelIndex++) {
    for (const symbol of window[reelIndex]) {
      if (
        !FORBIDDEN_GOLD_REELS.has(reelIndex) &&
        symbol.kind !== 'SCATTER' &&
        rng() < GOLD_CHANCE_INITIAL
      ) {
        symbol.isGold = true
        symbol.goldTTL = GOLD_TTL
      }
    }
  }

  const scatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

  const { totalWin, cascades } = runCascades(window, input.betPerSpin, isFreeGame, rng)

  let freeSpinsAwarded = !isFreeGame && scatterCount >= 3 ? GAME_CONFIG.freeSpinsAwarded : 0

  if (isFreeGame && scatterCount >= 3) {
    freeSpinsAwarded += 3
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

function forceThreeScatters(window: Symbol[][], rng: () => number) {
  const reels = window.length
  const rows = window[0].length

  // 1️⃣ Remove existing scatters by REPLACING them (not EMPTY)
  for (let r = 0; r < reels; r++) {
    for (let row = 0; row < rows; row++) {
      if (window[r][row].kind === 'SCATTER') {
        window[r][row] = drawSafeFillSymbol(rng)
      }
    }
  }

  // 2️⃣ Choose exactly 3 distinct reels (no edges)
  const chosenReels = shuffleArray([1, 2, 3], rng)

  // 3️⃣ Place exactly one scatter per reel
  for (const reel of chosenReels) {
    const row = Math.floor(rng() * rows)
    window[reel][row] = { kind: 'SCATTER' }
  }
}

function drawSafeFillSymbol(rng: () => number): Symbol {
  const pool = GAME_CONFIG.cascadeFillPool.filter(s => (s.kind as SymbolKind) !== 'SCATTER')
  return { ...pool[Math.floor(rng() * pool.length)] }
}

function shuffleArray<T>(arr: T[], rng: () => number): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
