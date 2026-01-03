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

  /* ----------------------------------------
     Determine valid starting symbols (reel 0)
  ---------------------------------------- */
  const startSymbols = new Set<SymbolKind>()

  for (let row = 0; row < rowCount; row++) {
    const s = window[0][row]
    if (s.kind === 'EMPTY' || s.kind === 'SCATTER') continue

    if (s.kind === 'WILD') {
      for (const k of Object.keys(PAYTABLE) as SymbolKind[]) {
        if (PAYTABLE[k].some(v => v > 0)) {
          startSymbols.add(k)
        }
      }
    } else {
      startSymbols.add(s.kind)
    }
  }

  /* ----------------------------------------
     Evaluate each symbol independently
  ---------------------------------------- */
  for (const symbol of startSymbols) {
    const winningReels: number[] = []

    /* ----------------------------------------
       Phase 1: determine winning columns
    ---------------------------------------- */
    for (let reel = 0; reel < reelCount; reel++) {
      let hasMatch = false

      for (let row = 0; row < rowCount; row++) {
        const s = window[reel][row]

        if (s.kind === symbol || (s.kind === 'WILD' && WILD_ALLOWED_COLUMNS.has(reel))) {
          hasMatch = true
          break
        }
      }

      if (!hasMatch) break

      winningReels.push(reel)
      if (winningReels.length === MAX_COLUMNS) break
    }

    if (winningReels.length < MIN_COLUMNS) continue

    /* ----------------------------------------
       Phase 2: collect ALL matching positions
    ---------------------------------------- */
    const positions: Position[] = []

    for (const reel of winningReels) {
      for (let row = 0; row < rowCount; row++) {
        const s = window[reel][row]

        if (s.kind === symbol || (s.kind === 'WILD' && WILD_ALLOWED_COLUMNS.has(reel))) {
          positions.push({ reel, row })
        }
      }
    }

    /* ----------------------------------------
       Payout calculation
    ---------------------------------------- */
    const paytable = PAYTABLE[symbol]
    const columns = winningReels.length
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
