import { PAYLINES } from './paylines'
import { PAYTABLE } from './paytable'
import { Symbol, SymbolKind } from '../types/symbol'

const PAYING_BASES: SymbolKind[] = ['A', 'K', 'Q', 'J']

export interface LineWin {
  lineIndex: number
  symbol: SymbolKind
  count: number
  payout: number
  positions: { reel: number; row: number }[]
}

export function evaluateWindow(
  window: Symbol[][],
  betPerLine: number,
  activeLines: number,
): LineWin[] {
  const wins: LineWin[] = []

  for (let i = 0; i < activeLines; i++) {
    const line = PAYLINES[i]
    if (!line) continue

    const positions = line.map((row, reel) => ({ reel, row }))
    const symbols = positions.map(p => window[p.reel][p.row])

    const base = symbols[0]

    if (!PAYING_BASES.includes(base.kind)) continue

    let count = 1

    for (let r = 1; r < symbols.length; r++) {
      const s = symbols[r]
      if (s.kind === base.kind || s.kind === 'WILD') {
        count++
      } else {
        break
      }
    }

    if (count >= 3) {
      const pay = PAYTABLE[base.kind]
      wins.push({
        lineIndex: i,
        symbol: base.kind,
        count,
        payout: pay[count - 1] * betPerLine,
        positions: positions.slice(0, count),
      })
    }
  }

  return wins
}
