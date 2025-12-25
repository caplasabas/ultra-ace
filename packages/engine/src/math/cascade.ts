// src/math/cascade.ts

import { Symbol } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateColumnWindow } from './evaluator.columns.js'
import { GAME_CONFIG } from '../config/game.config.js'
import { getCascadeMultiplier } from './multiplier.js'

import {
  RED_WILD_CHANCE,
  MAX_RED_PROPAGATION,
  RED_PROPAGATION_DIRS,
  BLOCKED_RED_WILD_KINDS,
  DEV_FORCE_RED_WILD,
} from '../config/wild.config.js'

const GOLD_CHANCE_REFILL = 0.06
const GOLD_TTL = 2

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

    const { wins } = evaluateColumnWindow(window, totalBet)
    if (wins.length === 0) break

    const resolved = wins.slice(0, 1)
    const removed: { reel: number; row: number }[] = []

    for (const w of resolved) {
      for (const pos of w.positions) {
        const s = window[pos.reel][pos.row]
        const isEdge = pos.reel === 0 || pos.reel === window.length - 1

        // ───────── GOLD CONVERSION ─────────
        if (s.isGold) {
          if (isEdge) {
            window[pos.reel][pos.row] = { kind: 'EMPTY' }
            removed.push(pos)
            continue
          }

          const isRed = DEV_FORCE_RED_WILD || Math.random() < RED_WILD_CHANCE

          const wild: Symbol = {
            kind: 'WILD',
            isWild: true,
            wildColor: isRed ? 'red' : 'blue',
          }

          window[pos.reel][pos.row] = wild

          if (isRed) {
            propagateRedWild(window, pos.reel, pos.row)
          }

          continue
        }

        // ───────── NORMAL REMOVAL ─────────
        window[pos.reel][pos.row] = { kind: 'EMPTY' }
        removed.push(pos)
      }
    }

    refillInPlace(window)
    decayGold(window)

    const baseWin = resolved.reduce((s, w) => s + w.payout, 0)
    const win = baseWin * multiplier

    totalWin += win

    cascades.push({
      index: i,
      multiplier,
      lineWins: resolved,
      win,
      removedPositions: removed,
      window: cloneWindow(window),
    })
  }

  return { totalWin, cascades }
}

// ────────────────────────────────────────────
// RED WILD PROPAGATION
// ────────────────────────────────────────────

function propagateRedWild(window: Symbol[][], startReel: number, startRow: number) {
  let propagated = 0

  for (const { dx, dy } of RED_PROPAGATION_DIRS) {
    if (propagated >= MAX_RED_PROPAGATION) break

    const r = startReel + dx
    const row = startRow + dy

    if (r < 0 || r >= window.length || row < 0 || row >= window[r].length) {
      continue
    }

    const target = window[r][row]

    if (BLOCKED_RED_WILD_KINDS.has(target.kind)) {
      continue
    }

    window[r][row] = {
      kind: 'WILD',
      isWild: true,
      wildColor: 'red',
    }

    propagated++
  }
}

// ────────────────────────────────────────────
// REFILL & DECAY (unchanged)
// ────────────────────────────────────────────

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

function decayGold(window: Symbol[][]) {
  for (const col of window) {
    for (const s of col) {
      if (s.isGold && typeof s.goldTTL === 'number') {
        s.goldTTL--
        if (s.goldTTL <= 0) {
          delete s.isGold
          delete s.goldTTL
        }
      }
    }
  }
}

function cloneWindow(w: Symbol[][]): Symbol[][] {
  return w.map(c => c.map(s => ({ ...s })))
}
