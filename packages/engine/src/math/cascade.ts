import { Symbol, SymbolKind } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateGlobalWindow } from './evaluator.global.js'
import { GAME_CONFIG } from '../config/game.config.js'

const BASE_WILD_CHANCE = [0, 0.05, 0.08, 0.12]
const GOLD_CHANCE_REFILL = 0.06
const GOLD_TTL = 2

export function runCascades(initialWindow: Symbol[][], totalBet: number) {
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
    const multiplier =
      GAME_CONFIG.multiplierLadder[Math.min(i - 1, GAME_CONFIG.multiplierLadder.length - 1)]

    const { wins } = evaluateGlobalWindow(window, totalBet * multiplier, i > 1, new Set())
    if (wins.length === 0) break

    const resolved = wins.slice(0, 1)
    const removed: { reel: number; row: number }[] = []

    for (const w of resolved) {
      for (const pos of w.positions) {
        const s = window[pos.reel][pos.row]

        // Gold → Wild ONLY when hit
        if (s.isGold) {
          window[pos.reel][pos.row] = { kind: 'WILD' }
          continue
        }

        window[pos.reel][pos.row] = { kind: 'EMPTY' as SymbolKind }
        removed.push(pos)
      }
    }

    refill(window, i)
    decayGold(window)

    const win = resolved.reduce((sum, w) => sum + w.payout, 0)
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
   Refill with decay
   ───────────────────────────── */
function refill(window: Symbol[][], cascadeIndex: number) {
  const wildChance = BASE_WILD_CHANCE[Math.min(cascadeIndex, BASE_WILD_CHANCE.length - 1)]

  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      if (window[r][row].kind === 'EMPTY') {
        let symbol: Symbol

        if (Math.random() < wildChance) {
          symbol = { kind: 'WILD' }
        } else {
          symbol = GAME_CONFIG.cascadeFillPool[
            Math.floor(Math.random() * GAME_CONFIG.cascadeFillPool.length)
          ] as Symbol
        }

        if (
          symbol.kind !== 'WILD' &&
          symbol.kind !== 'SCATTER' &&
          Math.random() < GOLD_CHANCE_REFILL
        ) {
          symbol = {
            ...symbol,
            isGold: true,
            goldTTL: GOLD_TTL,
          }
        }

        window[r][row] = symbol
      }
    }
  }
}

/* ─────────────────────────────
   Gold decay → Wild
   ───────────────────────────── */

function decayGold(window: Symbol[][]) {
  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      const s = window[r][row]

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
