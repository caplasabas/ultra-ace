import { Symbol, SymbolKind } from '../types/symbol.js'
import { PAYTABLE } from './paytable.js'
import { PINATA_PAYLINES } from './paylines.js'

export type Position = { reel: number; row: number }

const MIN_REELS = 3
const PAYING_SYMBOLS = (Object.keys(PAYTABLE) as SymbolKind[]).filter(kind =>
  PAYTABLE[kind].some(value => value > 0),
)

function isWild(symbol: Symbol): boolean {
  return symbol.kind === 'WILD' || Boolean(symbol.isWild)
}

function canMatch(symbol: Symbol, target: SymbolKind): boolean {
  return symbol.kind === target || isWild(symbol)
}

function getStartSymbols(symbol: Symbol): SymbolKind[] {
  if (symbol.kind === 'EMPTY' || symbol.kind === 'SCATTER') return []
  if (isWild(symbol)) return PAYING_SYMBOLS
  return PAYTABLE[symbol.kind]?.some(value => value > 0) ? [symbol.kind] : []
}

export function evaluatePaylineWindow(
  window: Symbol[][],
  totalBet: number,
  activeLines: number = PINATA_PAYLINES.length,
) {
  const wins: {
    symbol: SymbolKind
    lineIndex: number
    payline: number[]
    reels: number
    count: number
    payout: number
    positions: Position[]
  }[] = []

  const lineCount = Math.max(0, Math.min(activeLines, PINATA_PAYLINES.length))

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const payline = PINATA_PAYLINES[lineIndex]
    const start = window[0]?.[payline[0]]
    if (!start) continue

    let bestWin:
      | {
          symbol: SymbolKind
          lineIndex: number
          payline: number[]
          reels: number
          count: number
          payout: number
          positions: Position[]
        }
      | null = null

    for (const symbol of getStartSymbols(start)) {
      const positions: Position[] = []

      for (let reel = 0; reel < payline.length; reel++) {
        const row = payline[reel]
        const candidate = window[reel]?.[row]
        if (!candidate || !canMatch(candidate, symbol)) break
        positions.push({ reel, row })
      }

      if (positions.length < MIN_REELS) continue

      const count = positions.length
      const basePay = PAYTABLE[symbol]?.[count - 1] ?? 0
      if (basePay <= 0) continue

      const payout = basePay * totalBet
      if (!bestWin || payout > bestWin.payout) {
        bestWin = {
          symbol,
          lineIndex,
          payline: [...payline],
          reels: count,
          count,
          payout,
          positions,
        }
      }
    }

    if (bestWin) wins.push(bestWin)
  }

  wins.sort((a, b) => b.payout - a.payout)
  return { wins }
}
