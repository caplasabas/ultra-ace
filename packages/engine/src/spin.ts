import { PRNG } from './rng.js'
import { runCascades } from './math/cascade.js'
import { SpinInput, SpinOutcome } from './types/spin.js'
import { Symbol } from './types/symbol.js'
import { getEngineConfig, getEngineVersion, getReels } from './runtime/engineContext.js'

const FORBIDDEN_GOLD_REELS = new Set([0])

export function spin(rng: PRNG, input: SpinInput): SpinOutcome {
  const cfg = getEngineConfig()

  const isFreeGame = Boolean(input.isFreeGame)
  const totalBet = isFreeGame ? 0 : input.betPerSpin

  const { base, free } = getReels(cfg, getEngineVersion() ?? 'V1', rng)
  const reels = isFreeGame ? free : base

  const stops = reels.map(reel => Math.floor(rng() * reel.length))

  const window: Symbol[][] = reels.map((reel, reelIndex) =>
    Array.from({ length: cfg.reels.reelsVisibleRows }, (_, row) => {
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
      const goldChance = input.isFreeGame ? cfg.gold.freeInitialChance : cfg.gold.initialChance

      if (!FORBIDDEN_GOLD_REELS.has(reelIndex) && symbol.kind !== 'SCATTER' && rng() < goldChance) {
        symbol.isGold = true
        symbol.goldTTL = cfg.gold.ttl
      }
    }
  }

  const scatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

  const { totalWin, cascades } = runCascades(cfg, window, input.betPerSpin, isFreeGame, rng)

  let freeSpinsAwarded = !isFreeGame && scatterCount >= 3 ? cfg.scatter.baseAward : 0

  if (isFreeGame && scatterCount >= 3) {
    freeSpinsAwarded += cfg.scatter.retriggerAward
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
  const reels = window.length - 1

  const reelsWithScatter = new Set<number>()

  for (let r = 1; r < reels; r++) {
    if (window[r].some(s => s.kind === 'SCATTER')) {
      reelsWithScatter.add(r)
    }
  }

  const currentScatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

  if (currentScatterCount >= 3) return

  let remainingToAdd = 3 - currentScatterCount

  while (remainingToAdd > 0) {
    const candidateReels: number[] = []

    for (let r = 1; r < reels; r++) {
      if (!reelsWithScatter.has(r)) {
        candidateReels.push(r)
      }
    }

    if (!candidateReels.length) {
      for (let r = 1; r < reels; r++) candidateReels.push(r)
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
