import { Symbol, SymbolKind } from '../types/symbol.js'
import { PAYTABLE } from './paytable.js'

type Position = { reel: number; row: number }

const GROUP_BET_FACTOR = 0.135

const MIN_COUNT: Record<SymbolKind, number> = {
  A: 3,
  K: 3,
  Q: 3,
  J: 3,

  SPADE: 4,
  HEART: 4,
  DIAMOND: 4,
  CLUB: 4,

  WILD: 999,
  SCATTER: 999,
  EMPTY: 999,
}

export function evaluateRowWindow(window: Symbol[][], totalBet: number) {
  const reelCount = window.length
  const rowCount = window[0].length

  const rowWins = []

  for (let row = 0; row < rowCount; row++) {
    const buckets = new Map<SymbolKind, Position[]>()
    const wilds: Position[] = []

    for (let reel = 0; reel < reelCount; reel++) {
      const s = window[reel][row]
      const pos = { reel, row }

      if (s.kind === 'EMPTY' || s.kind === 'SCATTER') continue

      if (s.kind === 'WILD') {
        wilds.push(pos)
        continue
      }

      if (!buckets.has(s.kind)) {
        buckets.set(s.kind, [])
      }

      buckets.get(s.kind)!.push(pos)
    }

    let best: {
      kind: SymbolKind
      count: number
      positions: Position[]
      payout: number
    } | null = null

    for (const [kind, base] of buckets) {
      const min = MIN_COUNT[kind]
      const maxAssignable = base.length + wilds.length

      if (maxAssignable < min) continue

      // Try max possible count
      const count = Math.min(maxAssignable, reelCount)
      const payMult = PAYTABLE[kind]?.[count - 1] ?? 0
      if (payMult <= 0) continue

      const payout = payMult * totalBet * GROUP_BET_FACTOR

      if (!best || payout > best.payout) {
        best = {
          kind,
          count,
          payout,
          positions: [...base, ...wilds.slice(0, count - base.length)],
        }
      }
    }

    if (!best) continue

    rowWins.push({
      row,
      symbol: best.kind,
      count: best.count,
      payout: best.payout,
      positions: best.positions,
    })
  }

  return { rowWins }
}
