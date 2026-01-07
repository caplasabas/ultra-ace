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

function makeInitialCascade(window: Symbol[][]): CascadeStep {
  return {
    index: 0,
    multiplier: 1,
    lineWins: [],
    win: 0,
    removedPositions: [],
    window: cloneWindow(window),
  }
}

export function runCascades(
  initialWindow: Symbol[][],
  totalBet: number,
  isFreeGame: boolean,
  isForceScatter: boolean,
  rng: () => number,
) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  cascades.push(makeInitialCascade(window))

  /* -------------------------------------------------
     SCATTER LOCK — TERMINAL, NO OTHER WINS ALLOWED
  ------------------------------------------------- */
  const scatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

  if (scatterCount >= 3 && isForceScatter) {
    sanitizeNonScatterWins(window, rng)
    return { totalWin: 0, cascades: [makeInitialCascade(window)] }
  }

  /* -------------------------------------------------
     NORMAL CASCADE FLOW
  ------------------------------------------------- */
  for (let i = 1; i <= GAME_CONFIG.maxCascades; i++) {
    const multiplier = getCascadeMultiplier(
      i,
      isFreeGame,
      GAME_CONFIG.multiplierLadderBase,
      GAME_CONFIG.multiplierLadderFree,
    )

    if (multiplier >= MAX_MULTIPLIER) break

    const { wins } = evaluateColumnWindow(window, totalBet)
    if (wins.length === 0) break

    const removedSet = new Set<string>()
    const removed: { reel: number; row: number }[] = []
    let baseWin = 0

    function markForRemoval(pos: { reel: number; row: number }) {
      const key = `${pos.reel}-${pos.row}`
      if (removedSet.has(key)) return
      removedSet.add(key)
      removed.push(pos)
    }

    /* -----------------------------
       APPLY WINS
    ----------------------------- */
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
          const redChance = isFreeGame ? FREE_RED_WILD_CHANCE : RED_WILD_CHANCE
          const isRed = DEV_FORCE_RED_WILD || DEV_FORCE_BIG_JOKER || rng() < redChance

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

/* -------------------------------------------------
   BIG JOKER (RED WILD PROPAGATION)
------------------------------------------------- */
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

/* -------------------------------------------------
   REFILL (STACK-LIMITED)
------------------------------------------------- */
function refillInPlace(window: Symbol[][], rng: () => number, isFreeGame: boolean) {
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
        if (symbol.kind !== 'WILD' && sameKindCount < MAX_SAME_SYMBOL_PER_REEL) break
      } while (attempts < 20)

      const goldAllowed = r !== 0 && r !== window.length - 1
      const goldChance = isFreeGame ? FREE_GOLD_CHANCE_REFILL : GOLD_CHANCE_REFILL

      if (goldAllowed && symbol.kind !== 'SCATTER' && rng() < goldChance) {
        symbol.isGold = true
        symbol.goldTTL = GOLD_TTL
      }

      window[r][row] = symbol
    }
  }
}
function sanitizeNonScatterWins(window: Symbol[][], rng: () => number) {
  const reelCount = window.length
  const rowCount = window[0].length

  // 1️⃣ Build symbol → reels map
  const symbolReels = new Map<string, Set<number>>()

  for (let r = 0; r < reelCount; r++) {
    for (let row = 0; row < rowCount; row++) {
      const k = window[r][row].kind
      if (k === 'SCATTER') continue

      if (!symbolReels.has(k)) symbolReels.set(k, new Set())
      symbolReels.get(k)!.add(r)
    }
  }

  // 2️⃣ For any symbol present in 3+ reels, break it
  for (const [kind, reels] of symbolReels.entries()) {
    if (reels.size < 3) continue

    // Keep at most 2 reels
    const reelsToClear = [...reels].slice(2)

    for (const r of reelsToClear) {
      for (let row = 0; row < rowCount; row++) {
        if (window[r][row].kind === kind) {
          const s = drawSafeNonWinningSymbol(rng, kind)
          if (s.kind === 'EMPTY') throw new Error('sanitizeNonScatterWins produced EMPTY')
          window[r][row] = s
        }
      }
    }
  }
}

function drawSafeNonWinningSymbol(rng: () => number, forbidden: string): Symbol {
  const pool = GAME_CONFIG.cascadeFillPool.filter(s => s.kind !== forbidden)
  return { ...pool[Math.floor(rng() * pool.length)] }
}

/* -------------------------------------------------
   UTILS
------------------------------------------------- */
function cloneWindow(w: Symbol[][]): Symbol[][] {
  return w.map(col => col.map(s => ({ ...s })))
}

function shuffle<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
