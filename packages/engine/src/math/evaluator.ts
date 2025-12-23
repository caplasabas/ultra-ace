import { PAYLINES } from './paylines.js'
import { PAYTABLE } from './paytable.js'
import { Symbol, SymbolKind } from '../types/symbol.js'

/**
 * Symbols that can form a paying base
 * (expanded for higher hit-rate)
 */
const PAYING_BASES: SymbolKind[] = ['A', 'K', 'Q', 'J', 'SPADE', 'CLUB']

export interface LineWin {
  lineIndex: number
  symbol: SymbolKind
  count: number
  payout: number
  positions: { reel: number; row: number }[]
}

/**
 * Evaluates a window and returns all line wins.
 *
 * Enhancements:
 * - Wins may start on ANY reel
 * - WILD can START a win
 * - 2-of-a-kind pays (small)
 */
export function evaluateWindow(
  window: Symbol[][],
  betPerLine: number,
  activeLines: number,
): LineWin[] {
  const wins: LineWin[] = []

  for (let i = 0; i < activeLines; i++) {
    const line = PAYLINES[i]
    if (!line) continue

    // Build reel/row positions for this payline
    const positions = line.map((row, reel) => ({ reel, row }))
    const symbols = positions.map(p => window[p.reel][p.row])

    /**
     * Find first possible base symbol:
     * - Paying symbol OR WILD
     * - Can start on any reel
     */
    let baseIndex = -1
    let base: Symbol | null = null

    for (let r = 0; r < symbols.length; r++) {
      const s = symbols[r]
      if (PAYING_BASES.includes(s.kind) || s.kind === 'WILD') {
        baseIndex = r
        base = s
        break
      }
    }

    if (!base) continue

    /**
     * If base is WILD, try to resolve
     * to the first real paying symbol after it
     */
    if (base.kind === 'WILD') {
      const resolved = symbols.slice(baseIndex + 1).find(s => PAYING_BASES.includes(s.kind))

      if (!resolved) continue
      base = resolved
    }

    if (!PAYING_BASES.includes(base.kind)) continue

    /**
     * Count consecutive matches (base or WILD)
     */
    let count = 1

    for (let r = baseIndex + 1; r < symbols.length; r++) {
      const s = symbols[r]
      if (s.kind === base.kind || s.kind === 'WILD') {
        count++
      } else {
        break
      }
    }

    /**
     * Allow 3-of-a-kind payouts (low-tier)
     */
    if (count >= 3) {
      const payRow = PAYTABLE[base.kind]
      const payoutMultiplier = payRow[count - 1] ?? 0

      if (payoutMultiplier > 0) {
        wins.push({
          lineIndex: i,
          symbol: base.kind,
          count,
          payout: payoutMultiplier * betPerLine,
          positions: positions.slice(baseIndex, baseIndex + count),
        })
      }
    }
  }

  return wins
}
