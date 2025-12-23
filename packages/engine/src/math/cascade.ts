import { Symbol, SymbolKind } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateGlobalWindow } from './evaluator.global.js'
import { GAME_CONFIG } from '../config/game.config.js'

const BASE_WILD_CHANCE = [0, 0.05, 0.08, 0.12]

export function runCascades(initialWindow: Symbol[][], totalBet: number) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  // 🔒 Symbols that already paid this spin
  const wonSymbols = new Set<SymbolKind>()

  // ─────────────────────────────
  // Cascade 0 — initial snapshot
  // ─────────────────────────────
  cascades.push({
    index: 0,
    multiplier: 1,
    lineWins: [],
    win: 0,
    removedPositions: [],
    window: cloneWindow(window),
  })

  for (let i = 1; i <= GAME_CONFIG.maxCascades; i++) {
    const multiplier =
      GAME_CONFIG.multiplierLadder[Math.min(i - 1, GAME_CONFIG.multiplierLadder.length - 1)]

    const isRefill = i > 1

    const { wins } = evaluateGlobalWindow(window, totalBet * multiplier, isRefill, wonSymbols)

    // Optional UI limiter: only first win per cascade
    const limitedWins = wins.slice(0, 1)
    if (limitedWins.length === 0) break

    const removed: { reel: number; row: number }[] = []

    for (const w of limitedWins) {
      for (const pos of w.positions) {
        window[pos.reel][pos.row] = { kind: 'EMPTY' as SymbolKind }
        removed.push(pos)
      }
    }

    refill(window, i)

    const win = limitedWins.reduce((sum, w) => sum + w.payout, 0)
    totalWin += win

    cascades.push({
      index: i,
      multiplier,
      lineWins: limitedWins,
      win,
      removedPositions: removed,
      window: cloneWindow(window),
    })
  }

  return { totalWin, cascades }
}

// ─────────────────────────────
// Refill logic
// ─────────────────────────────
function refill(window: Symbol[][], cascadeIndex: number) {
  const wildChance = BASE_WILD_CHANCE[Math.min(cascadeIndex, BASE_WILD_CHANCE.length - 1)]

  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      if (window[r][row].kind === 'EMPTY') {
        if (Math.random() < wildChance) {
          window[r][row] = { kind: 'WILD' as SymbolKind }
        } else {
          window[r][row] = GAME_CONFIG.cascadeFillPool[
            Math.floor(Math.random() * GAME_CONFIG.cascadeFillPool.length)
          ] as Symbol
        }
      }
    }
  }
}

function cloneWindow(w: Symbol[][]): Symbol[][] {
  return w.map(col => col.map(s => ({ ...s })))
}
