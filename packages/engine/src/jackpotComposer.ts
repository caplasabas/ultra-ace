import { spin } from './spin.js'
import type { PRNG } from './rng.js'
import type { SpinOutcome } from './types/spin.js'
import type { Symbol } from './types/symbol.js'

const DEFAULT_BET_SCALES = [1, 1.35, 1.8, 2.4, 3.2, 4.2, 5.5, 7.2, 9.5, 12]
const DEFAULT_ATTEMPTS_PER_SCALE = 18
const DEFAULT_MAX_TOTAL_ATTEMPTS = 180
const DEFAULT_TOLERANCE_RATIO = 0.12
const DEFAULT_MIN_TOLERANCE = 25

export type TargetedFreeSpinComposeInput = {
  betPerSpin: number
  lines: number
  targetWin: number
  tolerance?: number
  freeSpinSource?: 'natural' | 'buy'
  betScales?: number[]
  attemptsPerScale?: number
  maxTotalAttempts?: number
}

export type TargetedFreeSpinComposeResult = {
  outcome: SpinOutcome
  targetWin: number
  tolerance: number
  diff: number
  attemptCount: number
  withinTolerance: boolean
  excitementScore: number
}

function toPositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value))
}

function normalizeBetScales(scales?: number[]): number[] {
  const source = Array.isArray(scales) && scales.length > 0 ? scales : DEFAULT_BET_SCALES
  const normalized = source
    .map(value => Number(value))
    .filter(value => Number.isFinite(value) && value > 0)
    .map(value => Math.round(value * 100) / 100)

  return normalized.length > 0 ? normalized : [...DEFAULT_BET_SCALES]
}

function clampWin(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Number(value))
}

function countWindowFeatures(window: Symbol[][] | undefined): {
  gold: number
  redWild: number
  wild: number
} {
  if (!window) return { gold: 0, redWild: 0, wild: 0 }

  let gold = 0
  let redWild = 0
  let wild = 0

  for (const reel of window) {
    for (const symbol of reel) {
      if (symbol.isGold) gold += 1
      if (symbol.kind === 'WILD') {
        wild += 1
        if (symbol.wildColor === 'red') redWild += 1
      }
    }
  }

  return { gold, redWild, wild }
}

function excitementScore(outcome: SpinOutcome): number {
  const cascades = outcome.cascades ?? []
  const paidCascades = cascades.filter(step => clampWin(step.win) > 0)
  const cascadeDepth = paidCascades.length
  const maxMultiplier = cascades.reduce(
    (max, step) => Math.max(max, Number.isFinite(step.multiplier) ? Number(step.multiplier) : 1),
    1,
  )
  const maxCascadeWin = cascades.reduce((max, step) => Math.max(max, clampWin(step.win)), 0)

  let gold = 0
  let redWild = 0
  let wild = 0
  for (const step of cascades) {
    const counts = countWindowFeatures(step.window)
    gold += counts.gold
    redWild += counts.redWild
    wild += counts.wild
  }

  const scatterPresence = (outcome.scatterCount ?? 0) >= 2 ? 1 : 0

  return (
    cascadeDepth * 6 +
    Math.max(0, maxMultiplier - 1) * 2.8 +
    Math.log10(maxCascadeWin + 1) * 9 +
    redWild * 1.9 +
    gold * 0.22 +
    wild * 0.08 +
    scatterPresence * 2
  )
}

export function composeTargetedFreeSpin(
  rng: PRNG,
  input: TargetedFreeSpinComposeInput,
): TargetedFreeSpinComposeResult {
  const targetWin = clampWin(Number(input.targetWin ?? 0))
  const baseBet = Math.max(0.01, Number(input.betPerSpin ?? 0))
  const lines = toPositiveInteger(Number(input.lines ?? 0), 5)
  const tolerance = Number.isFinite(Number(input.tolerance))
    ? Math.max(0, Number(input.tolerance))
    : Math.max(DEFAULT_MIN_TOLERANCE, targetWin * DEFAULT_TOLERANCE_RATIO)
  const freeSpinSource = input.freeSpinSource === 'buy' ? 'buy' : 'natural'
  const betScales = normalizeBetScales(input.betScales)
  const attemptsPerScale = toPositiveInteger(
    Number(input.attemptsPerScale ?? DEFAULT_ATTEMPTS_PER_SCALE),
    DEFAULT_ATTEMPTS_PER_SCALE,
  )
  const maxTotalAttempts = toPositiveInteger(
    Number(input.maxTotalAttempts ?? DEFAULT_MAX_TOTAL_ATTEMPTS),
    DEFAULT_MAX_TOTAL_ATTEMPTS,
  )

  let bestOutcome: SpinOutcome | null = null
  let bestDiff = Number.POSITIVE_INFINITY
  let bestExcitement = Number.NEGATIVE_INFINITY
  let attemptCount = 0
  const tieDiffThreshold = Math.max(1, tolerance * 0.08)

  outer: for (const scale of betScales) {
    const scaledBet = Math.max(0.01, baseBet * scale)
    for (let i = 0; i < attemptsPerScale; i++) {
      if (attemptCount >= maxTotalAttempts) break outer
      attemptCount += 1

      const outcome = spin(rng, {
        betPerSpin: scaledBet,
        lines,
        isFreeGame: true,
        freeSpinSource,
      })

      const win = clampWin(Number(outcome.win ?? 0))
      const diff = Math.abs(targetWin - win)
      const excitement = excitementScore(outcome)
      const isBetterDiff = diff < bestDiff - 0.0001
      const isTieButMoreExciting =
        Math.abs(diff - bestDiff) <= tieDiffThreshold && excitement > bestExcitement + 0.0001

      if (!bestOutcome || isBetterDiff || isTieButMoreExciting) {
        bestOutcome = outcome
        bestDiff = diff
        bestExcitement = excitement
      }

      if (attemptCount >= 32 && bestDiff <= tolerance * 0.35 && bestExcitement >= 24) {
        break outer
      }
    }
  }

  if (!bestOutcome) {
    bestOutcome = spin(rng, {
      betPerSpin: baseBet,
      lines,
      isFreeGame: true,
      freeSpinSource,
    })
    bestDiff = Math.abs(targetWin - clampWin(bestOutcome.win))
    bestExcitement = excitementScore(bestOutcome)
    attemptCount = Math.max(attemptCount, 1)
  }

  return {
    outcome: bestOutcome,
    targetWin,
    tolerance,
    diff: bestDiff,
    attemptCount,
    withinTolerance: bestDiff <= tolerance,
    excitementScore: bestExcitement,
  }
}
