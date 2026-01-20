import { PRNG } from './rng.js'
import { REELS } from './math/reels.js'
import { REELS_FREE } from './math/reels.free.js'
import { runCascades } from './math/cascade.js'
import { SpinInput, SpinOutcome } from './types/spin.js'
import { GAME_CONFIG } from './config/game.config.js'
import { Symbol } from './types/symbol.js'

// const GOLD_CHANCE_INITIAL = 0.0000000095
const GOLD_CHANCE_INITIAL = 0.012
// const FREE_GOLD_CHANCE_INITIAL = 0.00095
const FREE_GOLD_CHANCE_INITIAL = 0.018

const GOLD_TTL = 0
const FORBIDDEN_GOLD_REELS = new Set([0])
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
      const goldChangeInitial = isFreeGame ? FREE_GOLD_CHANCE_INITIAL : GOLD_CHANCE_INITIAL
      if (
        !FORBIDDEN_GOLD_REELS.has(reelIndex) &&
        symbol.kind !== 'SCATTER' &&
        rng() < goldChangeInitial
      ) {
        symbol.isGold = true
        symbol.goldTTL = GOLD_TTL
      }
    }
  }

  const scatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

  const { totalWin, cascades } = runCascades(
    window,
    input.betPerSpin,
    isFreeGame,
    Boolean(input.forceScatter),
    rng,
  )

  let freeSpinsAwarded = !isFreeGame && scatterCount >= 3 ? GAME_CONFIG.freeSpinsAwarded : 0

  if (isFreeGame && scatterCount >= 3) {
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
function reelWeight(reel: number, totalReels: number): number {
  if (reel === 0) return 0.5
  if (reel === totalReels - 1) return 1.25
  return 1.0
}

function pickWeightedReel(
  reels: number[],
  weightFn: (r: number) => number,
  rng: () => number,
): number | null {
  const total = reels.reduce((sum, r) => sum + weightFn(r), 0)
  if (total <= 0) return null

  let roll = rng() * total
  for (const r of reels) {
    roll -= weightFn(r)
    if (roll <= 0) return r
  }
  return null
}

function forceThreeScatters(window: Symbol[][], rng: () => number) {
  const reels = window.length

  const reelsWithScatter = new Set<number>()

  for (let r = 0; r < reels; r++) {
    if (window[r].some(s => s.kind === 'SCATTER')) {
      reelsWithScatter.add(r)
    }
  }

  const currentScatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

  if (currentScatterCount >= 3) return

  let remainingToAdd = 3 - currentScatterCount

  while (remainingToAdd > 0) {
    const candidateReels: number[] = []

    for (let r = 0; r < reels; r++) {
      if (!reelsWithScatter.has(r)) {
        candidateReels.push(r)
      }
    }

    if (!candidateReels.length) {
      for (let r = 0; r < reels; r++) candidateReels.push(r)
    }

    const reel = pickWeightedReel(candidateReels, r => reelWeight(r, reels), rng)
    if (reel == null) return

    const openRows = window[reel].map((s, row) => ({ s, row })).filter(x => x.s.kind !== 'SCATTER')

    if (!openRows.length) {
      reelsWithScatter.add(reel)
      continue
    }

    const { row } = openRows[Math.floor(rng() * openRows.length)]
    window[reel][row] = { kind: 'SCATTER' }

    reelsWithScatter.add(reel)
    remainingToAdd--
  }
}
