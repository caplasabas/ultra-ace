import { Symbol, SymbolKind } from '../types/symbol.js'
import { PAYTABLE } from './paytable.js'

type Position = { reel: number; row: number }

const GROUP_BET_FACTOR = 0.2
const MAX_COUNT_CAP = 8

/**
 * Minimum effective count by symbol.
 * High symbols pay from 3.
 * Low symbols pay from 4 (refill only).
 */
const MIN_COUNT_BY_SYMBOL: Record<SymbolKind, number> = {
  J: 3,
  Q: 3,
  K: 3,
  A: 3,

  SPADE: 4,
  HEART: 4,
  DIAMOND: 4,
  CLUB: 4,

  WILD: 999,
  SCATTER: 999,
  EMPTY: 999,
}

interface Bucket {
  kind: SymbolKind
  base: Position[]
  wilds: Position[]
}

export function evaluateGlobalWindow(
  window: Symbol[][],
  totalBet: number,
  isRefill: boolean,
  wonSymbols: Set<SymbolKind>,
): {
  wins: {
    symbol: SymbolKind
    count: number
    payout: number
    positions: Position[]
  }[]
} {
  const buckets = new Map<SymbolKind, Bucket>()
  const wildPool: Position[] = []

  // ─────────────────────────────
  // Scan window
  // ─────────────────────────────
  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      const s = window[r][row]
      const pos = { reel: r, row }

      if (s.kind === 'EMPTY' || s.kind === 'SCATTER') continue

      if (s.kind === 'WILD') {
        wildPool.push(pos)
        continue
      }

      if (!buckets.has(s.kind)) {
        buckets.set(s.kind, { kind: s.kind, base: [], wilds: [] })
      }

      buckets.get(s.kind)!.base.push(pos)
    }
  }

  // ─────────────────────────────
  // Candidate buckets (symbol exhaustion enforced)
  // ─────────────────────────────
  const candidates = Array.from(buckets.values()).filter(b => {
    if (wonSymbols.has(b.kind)) return false

    const min = MIN_COUNT_BY_SYMBOL[b.kind] ?? 3
    return b.base.length + wildPool.length >= min
  })

  // ─────────────────────────────
  // Greedy wild allocation
  // ─────────────────────────────
  const remainingWilds = [...wildPool]

  const payoutFor = (k: SymbolKind, c: number) => {
    const min = MIN_COUNT_BY_SYMBOL[k] ?? 3
    return c >= min ? (PAYTABLE[k]?.[Math.min(c, MAX_COUNT_CAP) - 1] ?? 0) : 0
  }

  while (remainingWilds.length > 0) {
    let best: { bucket: Bucket; delta: number } | null = null

    for (const b of candidates) {
      const cur = b.base.length + b.wilds.length
      const next = cur + 1
      const delta = payoutFor(b.kind, next) - payoutFor(b.kind, cur)

      if (delta > 0 && (!best || delta > best.delta)) {
        best = { bucket: b, delta }
      }
    }

    if (!best) break
    best.bucket.wilds.push(remainingWilds.pop()!)
  }

  // ─────────────────────────────
  // Finalize wins
  // ─────────────────────────────
  const wins = []

  for (const b of candidates) {
    const count = b.base.length + b.wilds.length
    const min = MIN_COUNT_BY_SYMBOL[b.kind] ?? 3

    // Low symbols cannot win on initial board
    if (!isRefill && min > 3) continue
    if (count < min) continue

    const mult = payoutFor(b.kind, count)
    if (mult <= 0) continue

    wins.push({
      symbol: b.kind,
      count,
      payout: mult * totalBet * GROUP_BET_FACTOR,
      positions: [...b.base, ...b.wilds],
    })

    // 🔒 Exhaust symbol for this spin
    wonSymbols.add(b.kind)
  }

  return { wins }
}
