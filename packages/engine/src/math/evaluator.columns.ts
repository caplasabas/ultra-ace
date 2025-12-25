import { Symbol, SymbolKind } from '../types/symbol.js'
import { PAYTABLE } from './paytable.js'

type Position = { reel: number; row: number }

const MIN_COLUMNS = 3
const MAX_COLUMNS = 5
const BET_REFERENCE = 0.6

const WILD_ALLOWED_COLUMNS = new Set([1, 2, 3])

export function evaluateColumnWindow(window: Symbol[][], totalBet: number) {
  const reelCount = window.length
  const rowCount = window[0].length

  const wins = []

  // Symbols must originate from reel 0
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
      let matched = false

      for (let row = 0; row < rowCount; row++) {
        const s = window[reel][row]

        if (s.kind === symbol) {
          matched = true
          positions.push({ reel, row })
        } else if (s.kind === 'WILD' && WILD_ALLOWED_COLUMNS.has(reel)) {
          matched = true
          positions.push({ reel, row })
        }
      }

      if (!matched) break

      columns++
      if (columns === MAX_COLUMNS) break
    }

    if (columns < MIN_COLUMNS) continue

    const payMult = PAYTABLE[symbol]?.[columns - 1] ?? 0
    if (payMult <= 0) continue

    const payout = (payMult / BET_REFERENCE) * totalBet

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
