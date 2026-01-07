import { Symbol } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateColumnWindow } from './evaluator.columns.js'
import { GAME_CONFIG } from '../config/game.config.js'
import { getCascadeMultiplier } from './multiplier.js'
import {
  RED_WILD_CHANCE,
  FREE_RED_WILD_CHANCE,
  BIG_JOKER_MIN,
  BIG_JOKER_MAX,
  DEV_FORCE_RED_WILD,
  DEV_FORCE_BIG_JOKER,
  BLOCKED_JOKER_KINDS,
} from '../config/wild.config.js'

const GOLD_CHANCE_REFILL = 0.025
const FREE_GOLD_CHANCE_REFILL = 0.055

const GOLD_TTL = 0
const MAX_PAYOUT = 2_000_000
const MAX_MULTIPLIER = 10_000

const MAX_SAME_SYMBOL_PER_REEL = 20

export function runCascades(
  initialWindow: Symbol[][],
  totalBet: number,
  isFreeGame: boolean,
  rng: () => number,
) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  const scatterCount = window.flat().filter(s => s.kind === 'SCATTER').length
  const scatterLocked = scatterCount >= 3

  cascades.push({
    index: 0,
    multiplier: 1,
    lineWins: [],
    win: 0,
    removedPositions: [],
    window: cloneWindow(window),
  })

  clearDecorativeGold(window)

  for (let i = 1; i <= GAME_CONFIG.maxCascades; i++) {
    const multiplier = getCascadeMultiplier(
      i,
      isFreeGame,
      GAME_CONFIG.multiplierLadderBase,
      GAME_CONFIG.multiplierLadderFree,
    )

    if (multiplier >= MAX_MULTIPLIER) break

    const { wins } = evaluateColumnWindow(window, totalBet)
    if (wins.length === 0 && scatterLocked) break

    const removedSet = new Set<string>()
    const removed: { reel: number; row: number }[] = []
    let baseWin = 0

    const wildTriggered = wins.some(w =>
      w.positions.some(p => window[p.reel][p.row].kind === 'WILD'),
    )

    /* ───────── PROMOTE ALL WILDS TO WINNERS (visual only) ───────── */

    if (wildTriggered) {
      const wildPositions: { reel: number; row: number }[] = []

      for (let reel = 0; reel < window.length; reel++) {
        for (let row = 0; row < window[reel].length; row++) {
          if (window[reel][row].kind === 'WILD') {
            wildPositions.push({ reel, row })
          }
        }
      }

      wins.push({
        symbol: 'WILD',
        count: wildPositions.length,
        reels: wildPositions.length,
        payout: 0,
        positions: wildPositions,
      })
    }

    function markForRemoval(pos: { reel: number; row: number }) {
      const key = `${pos.reel}-${pos.row}`
      if (removedSet.has(key)) return
      removedSet.add(key)
      removed.push(pos)
    }

    /* ───────── PROCESS ALL WIN GROUPS ───────── */

    for (const w of wins) {
      baseWin += w.payout

      for (const pos of w.positions) {
        const s = window[pos.reel][pos.row]
        const isEdge = pos.reel === 0

        markForRemoval(pos)

        if (isEdge) {
          window[pos.reel][pos.row] = { kind: 'EMPTY' }
          continue
        }

        if (s.isGold) {
          const redWildChange = isFreeGame ? FREE_RED_WILD_CHANCE : RED_WILD_CHANCE
          const isRed = DEV_FORCE_RED_WILD || DEV_FORCE_BIG_JOKER || rng() < redWildChange

          window[pos.reel][pos.row] = {
            kind: 'WILD',
            isWild: true,
            wildColor: isRed ? 'red' : 'blue',
            fromGold: true,
          }

          if (isRed) propagateBigJoker(window, rng)
          continue
        }

        window[pos.reel][pos.row] = { kind: 'EMPTY' }
      }
    }

    const win = baseWin * multiplier

    totalWin += win
    if (totalWin >= MAX_PAYOUT) break

    if (scatterLocked) {
      const removed: { reel: number; row: number }[] = []

      for (const w of wins) {
        for (const pos of w.positions) {
          removed.push(pos)
          window[pos.reel][pos.row] = { kind: 'EMPTY' }
        }
      }

      cascades.push({
        index: i,
        multiplier,
        lineWins: wins.filter(w => w.symbol !== 'SCATTER'),
        win: baseWin * multiplier,
        removedPositions: removed,
        window: cloneWindow(window), // ⬅️ now reflects removal
      })

      break
    }

    refillInPlace(window, rng, isFreeGame)

    cascades.push({
      index: i,
      multiplier,
      lineWins: wins,
      win,
      removedPositions: removed,
      window: cloneWindow(window),
    })
  }

  return { totalWin, cascades }
}

/* ───────── BIG JOKER (RED WILD PROPAGATION) ───────── */

function propagateBigJoker(window: Symbol[][], rng: () => number) {
  const candidates: { reel: number; row: number }[] = []

  for (let reel = 1; reel <= 3; reel++) {
    for (let row = 0; row < window[reel].length; row++) {
      const s = window[reel][row]
      if (s.kind !== 'WILD' && !BLOCKED_JOKER_KINDS.has(s.kind)) {
        candidates.push({ reel, row })
      }
    }
  }

  shuffle(candidates, rng)

  const count = BIG_JOKER_MIN + Math.floor(rng() * (BIG_JOKER_MAX - BIG_JOKER_MIN + 1))

  for (let i = 0; i < Math.min(count, candidates.length); i++) {
    const { reel, row } = candidates[i]
    window[reel][row] = {
      kind: 'WILD',
      isWild: true,
      wildColor: 'red',
    }
  }
}

/* ───────── REFILL (STACK-LIMITED) ───────── */
function refillInPlace(window: Symbol[][], rng: () => number, isFreeGame: boolean) {
  const refilled: { r: number; row: number }[] = []

  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      if (window[r][row].kind !== 'EMPTY') continue

      let symbol: Symbol
      let attempts = 0

      do {
        symbol = {
          ...GAME_CONFIG.cascadeFillPool[Math.floor(rng() * GAME_CONFIG.cascadeFillPool.length)],
        }

        attempts++

        const sameKindCount = window[r].filter(s => s.kind === symbol.kind).length

        if (symbol.kind !== 'WILD' && sameKindCount < MAX_SAME_SYMBOL_PER_REEL) {
          break
        }
      } while (attempts < 20)

      const goldAllowed = r !== 0 && r !== window.length - 1

      const goldChangeRefill = isFreeGame ? FREE_GOLD_CHANCE_REFILL : GOLD_CHANCE_REFILL

      if (goldAllowed && symbol.kind !== 'SCATTER' && rng() < goldChangeRefill) {
        symbol.isGold = true
        symbol.goldTTL = GOLD_TTL
      }

      window[r][row] = symbol
      refilled.push({ r, row })
    }
  }

  return refilled
}
function decorateFreeSpinGoldOnRefill(
  window: Symbol[][],
  refilled: { r: number; row: number }[],
  rng: () => number,
  intensity: number,
) {
  const eligible = refilled.filter(({ r }) => r !== 0)

  if (eligible.length === 0) return

  shuffle(eligible, rng)

  const count = Math.floor(eligible.length * intensity)

  for (let i = 0; i < count; i++) {
    const { r, row } = eligible[i]
    const s = window[r][row]

    if (s.kind === 'SCATTER' || s.kind === 'WILD' || s.isGold) continue

    s.isDecorativeGold = true
  }
}

function clearDecorativeGold(window: Symbol[][]) {
  for (const col of window) {
    for (const s of col) {
      if (s.isDecorativeGold) delete s.isDecorativeGold
    }
  }
}

/* ───────── UTILS ───────── */

function cloneWindow(w: Symbol[][]): Symbol[][] {
  return w.map(col => col.map(s => ({ ...s })))
}

function shuffle<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
