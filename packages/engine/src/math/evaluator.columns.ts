import { Symbol, SymbolKind } from '../types/symbol.js'
import { PAYTABLE } from './paytable.js'

type Position = { reel: number; row: number }

const MIN_REELS = 3
const MAX_REELS = 5
const BET_REFERENCE = 0.6
const WILD_ALLOWED_COLUMNS = new Set([1, 2, 3])

/* ----------------------------------------
   Density multiplier (industry-style)
---------------------------------------- */
function densityMultiplier(cardCount: number, reels: number) {
  const minCards = reels // 1 per reel minimum
  const maxCards = reels * 4 // full stack

  if (cardCount <= minCards) return 1

  const t = (cardCount - minCards) / (maxCards - minCards)

  // Soft exponential curve (tunable)
  return 1 + Math.pow(t, 1.6) * 1.25
}

export function evaluateColumnWindow(window: Symbol[][], totalBet: number) {
  const reelCount = window.length
  const rowCount = window[0].length

  const wins: {
    symbol: SymbolKind
    reels: number
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
       Phase 1: determine contiguous reels
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
      if (winningReels.length === MAX_REELS) break
    }

    if (winningReels.length < MIN_REELS) continue

    /* ----------------------------------------
       Phase 2: collect ALL matching cards
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

    const reelsUsed = winningReels.length
    const cardCount = positions.length

    /* ----------------------------------------
       Payout calculation
    ---------------------------------------- */
    const paytable = PAYTABLE[symbol]
    const payIndex = reelsUsed === 3 ? 2 : reelsUsed === 4 ? 3 : 4

    const basePayMult = paytable?.[payIndex] ?? 0
    if (basePayMult <= 0) continue

    const densityMult = densityMultiplier(cardCount, reelsUsed)

    const payout = ((basePayMult * densityMult) / BET_REFERENCE) * totalBet

    wins.push({
      symbol,
      reels: reelsUsed,
      count: cardCount,
      payout,
      positions,
    })
  }

  wins.sort((a, b) => b.payout - a.payout)
  return { wins }
}
