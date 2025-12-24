import { Symbol, SymbolKind } from '../types/symbol.js'
import { PAYTABLE } from './paytable.js'

type Position = { reel: number; row: number }

const GROUP_BET_FACTOR = 0.015

const MIN_COLUMNS = 3
const MAX_COLUMNS = 5

/**
 * Column-based evaluator
 *
 * Rules:
 * - Must start from LEFTMOST column (reel 0)
 * - Columns must be CONTIGUOUS
 * - Each column contributes AT MOST 1 count
 * - Symbol may appear in ANY row in a column
 * - WILD substitutes
 * - ONE best win only
 */
export function evaluateColumnWindow(window: Symbol[][], totalBet: number) {
  const reelCount = window.length
  const rowCount = window[0].length

  const wins = []

  // Collect candidate symbols from column 0 (no EMPTY / SCATTER)
  const startSymbols = new Set<SymbolKind>()

  for (let row = 0; row < rowCount; row++) {
    const s = window[0][row]
    if (s.kind !== 'EMPTY' && s.kind !== 'SCATTER' && s.kind !== 'WILD') {
      startSymbols.add(s.kind)
    }
  }

  for (const symbol of startSymbols) {
    let count = 0
    const positions: Position[] = []

    for (let reel = 0; reel < reelCount; reel++) {
      let matchedPos: Position | null = null

      for (let row = 0; row < rowCount; row++) {
        const s = window[reel][row]

        if (s.kind === symbol || s.kind === 'WILD') {
          matchedPos = { reel, row }
          break
        }
      }

      if (!matchedPos) break

      count++
      positions.push(matchedPos)

      if (count === MAX_COLUMNS) break
    }

    if (count < MIN_COLUMNS) continue

    const payMult = PAYTABLE[symbol]?.[count - 1] ?? 0
    if (payMult <= 0) continue

    const payout = payMult * totalBet * GROUP_BET_FACTOR

    wins.push({
      symbol,
      count,
      payout,
      positions,
    })
  }

  // Highest paying win first
  wins.sort((a, b) => b.payout - a.payout)

  return { wins }
}
