import { Symbol, SymbolKind } from '../types/symbol.js'
import { PAYTABLE } from './paytable.js'

type Position = { reel: number; row: number }

const GROUP_BET_FACTOR = 0.0169
const MIN_COLUMNS = 3
const MAX_COLUMNS = 5

const WILD_ALLOWED_COLUMNS = new Set([1, 2, 3])

export function evaluateColumnWindow(window: Symbol[][], totalBet: number) {
  const reelCount = window.length
  const rowCount = window[0].length

  const wins = []

  // Candidates must come from column 0 (NO wilds allowed)
  const startSymbols = new Set<SymbolKind>()

  for (let row = 0; row < rowCount; row++) {
    const s = window[0][row]
    if (s.kind !== 'EMPTY' && s.kind !== 'SCATTER' && s.kind !== 'WILD') {
      startSymbols.add(s.kind)
    }
  }

  for (const symbol of startSymbols) {
    let columns = 0
    const positions: Position[] = []

    for (let reel = 0; reel < reelCount; reel++) {
      let columnMatched = false

      for (let row = 0; row < rowCount; row++) {
        const s = window[reel][row]

        if (s.kind === symbol) {
          columnMatched = true
          positions.push({ reel, row })
        } else if (s.kind === 'WILD' && WILD_ALLOWED_COLUMNS.has(reel)) {
          columnMatched = true
          positions.push({ reel, row })
        }
      }

      if (!columnMatched) break

      columns++
      if (columns === MAX_COLUMNS) break
    }

    if (columns < MIN_COLUMNS) continue

    const payMult = PAYTABLE[symbol]?.[columns - 1] ?? 0
    if (payMult <= 0) continue

    const payout = payMult * totalBet * GROUP_BET_FACTOR

    wins.push({
      symbol,
      count: columns,
      payout,
      positions,
    })
  }

  wins.sort((a, b) => b.payout - a.payout)
  return { wins }
}
