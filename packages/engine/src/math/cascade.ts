import { Symbol } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateColumnWindow } from './evaluator.columns.js'
import { GAME_CONFIG } from '../config/game.config.js'
import { getCascadeMultiplier } from './multiplier.js'
import {
  RED_WILD_CHANCE,
  BIG_JOKER_MIN,
  BIG_JOKER_MAX,
  DEV_FORCE_RED_WILD,
  DEV_FORCE_BIG_JOKER,
  BLOCKED_JOKER_KINDS,
} from '../config/wild.config.js'

const GOLD_CHANCE_REFILL = 0.02
const GOLD_TTL = 0
const MAX_PAYOUT = 2_000_000
const MAX_MULTIPLIER = 10_000

export function runCascades(initialWindow: Symbol[][], totalBet: number, isFreeGame: boolean) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  cascades.push({
    index: 0,
    multiplier: 1,
    lineWins: [],
    win: 0,
    removedPositions: [],
    window: cloneWindow(window),
  })

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

    for (const w of wins) {
      baseWin += w.payout

      for (const pos of w.positions) {
        const key = `${pos.reel}-${pos.row}`
        if (removedSet.has(key)) continue
        removedSet.add(key)

        const s = window[pos.reel][pos.row]
        const isEdge = pos.reel === 0 || pos.reel === window.length - 1

        /* ───────── GOLD → WILD (IMMEDIATE) ───────── */
        if (s.isGold) {
          if (isEdge) {
            window[pos.reel][pos.row] = { kind: 'EMPTY' }
            removed.push(pos)
            continue
          }

          const isRed = DEV_FORCE_RED_WILD || DEV_FORCE_BIG_JOKER || Math.random() < RED_WILD_CHANCE

          window[pos.reel][pos.row] = {
            kind: 'WILD',
            isWild: true,
            wildColor: isRed ? 'red' : 'blue',

            // 🔑 UI animation hook
            fromGold: true,
          }

          if (isRed) propagateBigJoker(window)
          continue
        }

        /* ───────── NORMAL REMOVAL ───────── */
        window[pos.reel][pos.row] = { kind: 'EMPTY' }
        removed.push(pos)
      }
    }

    const win = baseWin * multiplier
    totalWin += win
    if (totalWin >= MAX_PAYOUT) break

    refillInPlace(window)

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

/* ───────── BIG JOKER ───────── */

function propagateBigJoker(window: Symbol[][]) {
  const candidates: { reel: number; row: number }[] = []

  for (let reel = 1; reel <= 4; reel++) {
    for (let row = 0; row < window[reel].length; row++) {
      const s = window[reel][row]
      if (!BLOCKED_JOKER_KINDS.has(s.kind)) {
        candidates.push({ reel, row })
      }
    }
  }

  shuffle(candidates)

  const count = BIG_JOKER_MIN + Math.floor(Math.random() * (BIG_JOKER_MAX - BIG_JOKER_MIN + 1))

  for (let i = 0; i < Math.min(count, candidates.length); i++) {
    const { reel, row } = candidates[i]
    window[reel][row] = {
      kind: 'WILD',
      isWild: true,
      wildColor: 'red',
    }
  }
}

/* ───────── REFILL ───────── */

function refillInPlace(window: Symbol[][]) {
  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      if (window[r][row].kind !== 'EMPTY') continue

      let symbol = GAME_CONFIG.cascadeFillPool[
        Math.floor(Math.random() * GAME_CONFIG.cascadeFillPool.length)
      ] as Symbol

      const goldAllowed = r !== 0 && r !== window.length - 1

      if (goldAllowed && symbol.kind !== 'SCATTER' && Math.random() < GOLD_CHANCE_REFILL) {
        symbol = { ...symbol, isGold: true, goldTTL: GOLD_TTL }
      }

      window[r][row] = symbol
    }
  }
}

function cloneWindow(w: Symbol[][]): Symbol[][] {
  return w.map(c => c.map(s => ({ ...s })))
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
