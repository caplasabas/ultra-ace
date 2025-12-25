// src/math/cascade.ts
import { Symbol } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateColumnWindow } from './evaluator.columns.js'
import { GAME_CONFIG } from '../config/game.config.js'
import { getCascadeMultiplier } from './multiplier.js'

const GOLD_CHANCE_REFILL = 0.06
const GOLD_TTL = 2

export function runCascades(initialWindow: Symbol[][], totalBet: number) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  // Base spin (index 0)
  cascades.push({
    index: 0,
    multiplier: 1,
    lineWins: [],
    win: 0,
    removedPositions: [],
    window: cloneWindow(window),
  })

  for (let i = 1; i <= GAME_CONFIG.maxCascades; i++) {
    const multiplier = getCascadeMultiplier(i)

    // 🔑 evaluate using BASE bet only
    const { wins } = evaluateColumnWindow(window, totalBet)
    if (wins.length === 0) break

    const resolved = wins.slice(0, 1)
    const removed: { reel: number; row: number }[] = []

    /* 1️⃣ REMOVE WINNING SYMBOLS */
    for (const w of resolved) {
      for (const pos of w.positions) {
        const s = window[pos.reel][pos.row]
        const isEdgeColumn = pos.reel === 0 || pos.reel === window.length - 1

        if (s.isGold) {
          if (!isEdgeColumn) {
            window[pos.reel][pos.row] = { kind: 'WILD' }
          } else {
            window[pos.reel][pos.row] = { kind: 'EMPTY' }
            removed.push(pos)
          }
          continue
        }

        window[pos.reel][pos.row] = { kind: 'EMPTY' }
        removed.push(pos)
      }
    }

    /* 2️⃣ REFILL */
    refillInPlace(window)

    /* 3️⃣ GOLD DECAY */
    decayGold(window)

    const RTP_SCALAR = 0.97

    const baseWin = resolved.reduce((sum, w) => sum + w.payout, 0)
    const win = baseWin * multiplier * RTP_SCALAR

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

/* ─────────────────────────────
   Refill EXACT empty slots
   (NO gravity, NO wild spawn)
   ───────────────────────────── */
function refillInPlace(window: Symbol[][]) {
  for (let reel = 0; reel < window.length; reel++) {
    for (let row = 0; row < window[reel].length; row++) {
      if (window[reel][row].kind !== 'EMPTY') continue

      let symbol = GAME_CONFIG.cascadeFillPool[
        Math.floor(Math.random() * GAME_CONFIG.cascadeFillPool.length)
      ] as Symbol

      const goldAllowed = reel !== 0 && reel !== window.length - 1

      if (goldAllowed && symbol.kind !== 'SCATTER' && Math.random() < GOLD_CHANCE_REFILL) {
        symbol = { ...symbol, isGold: true, goldTTL: GOLD_TTL }
      }

      window[reel][row] = symbol
    }
  }
}

/* ─────────────────────────────
   Gold decay (no auto-wild)
   ───────────────────────────── */
function decayGold(window: Symbol[][]) {
  for (let reel = 0; reel < window.length; reel++) {
    for (let row = 0; row < window[reel].length; row++) {
      const s = window[reel][row]
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
  return w.map(col => col.map(s => ({ ...s })))
}
