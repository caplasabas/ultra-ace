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

  const wins: {
    symbol: SymbolKind
    count: number
    payout: number
    positions: Position[]
  }[] = []

  const startSymbols = new Set<SymbolKind>()

  for (let row = 0; row < rowCount; row++) {
    const s = window[0][row]
    if (s.kind === 'EMPTY' || s.kind === 'SCATTER') continue

    if (s.kind === 'WILD') {
      for (const k of Object.keys(PAYTABLE) as SymbolKind[]) {
        if (PAYTABLE[k].some(v => v > 0)) startSymbols.add(k)
      }
    } else {
      startSymbols.add(s.kind)
    }
  }

  for (const symbol of startSymbols) {
    let columns = 0
    const positions: Position[] = []
    const used = new Set<string>()

    for (let reel = 0; reel < reelCount; reel++) {
      let matched = false

      for (let row = 0; row < rowCount; row++) {
        const s = window[reel][row]
        const key = `${reel}-${row}`

        if (used.has(key)) continue

        if (s.kind === symbol || (s.kind === 'WILD' && WILD_ALLOWED_COLUMNS.has(reel))) {
          matched = true
          used.add(key)
          positions.push({ reel, row })
          break
        }
      }

      if (!matched) break

      columns++
      if (columns === MAX_COLUMNS) break
    }

    if (columns < MIN_COLUMNS) continue

    const paytable = PAYTABLE[symbol]
    const payIndex = columns === 3 ? 2 : columns === 4 ? 3 : 4
    const payMult = paytable?.[payIndex] ?? 0
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
