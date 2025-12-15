import { REELS } from './reels'
import { PAYLINES } from './paylines'
import { PAYTABLE } from './paytable'
import { Symbol, SymbolKind } from '../types/symbol'
import { SCATTER_CONFIG } from '../config/scatter.config'

export interface LineWin {
  lineIndex: number
  symbol: SymbolKind
  count: number
  payout: number
  positions: { reel: number; row: number }[]
}

export interface EvalResult {
  window: Symbol[][]
  win: number
  lineWins: LineWin[]
  scatter: {
    count: number
    positions: { reel: number; row: number }[]
    freeSpins: number
  }
}

const PAYING_BASES: SymbolKind[] = ['A', 'K', 'Q', 'J']

export function evaluateSpin(
  reelStops: number[],
  betPerLine: number,
  activeLines: number,
  rows: number,
): EvalResult {
  const window = REELS.map((reel, i) => buildWindow(reel, reelStops[i], rows))

  // -------- SCATTER --------
  let scatterCount = 0
  const scatterPositions: { reel: number; row: number }[] = []

  for (let r = 0; r < window.length; r++) {
    if (!SCATTER_CONFIG.reels.includes(r)) continue
    for (let row = 0; row < rows; row++) {
      if (window[r][row].kind === 'SCATTER') {
        scatterCount++
        scatterPositions.push({ reel: r, row })
      }
    }
  }

  // -------- LINES --------
  const lineWins: LineWin[] = []

  for (let i = 0; i < activeLines; i++) {
    const line = PAYLINES[i]
    const positions = line.map((row, reel) => ({ reel, row }))
    const symbols = positions.map(p => window[p.reel][p.row])

    const base = symbols[0]

    // must start on reel 0
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
      lineWins.push({
        lineIndex: i,
        symbol: base.kind,
        count,
        payout: pay[count - 1] * betPerLine,
        positions: positions.slice(0, count),
      })
    }
  }

  const win = lineWins.reduce((s, l) => s + l.payout, 0)

  return {
    window,
    win,
    lineWins,
    scatter: {
      count: scatterCount,
      positions: scatterPositions,
      freeSpins: SCATTER_CONFIG.freeSpins[scatterCount] ?? 0,
    },
  }
}

function buildWindow(reel: Symbol[], stop: number, rows: number): Symbol[] {
  const len = reel.length
  const half = Math.floor(rows / 2)
  return Array.from({ length: rows }, (_, i) => reel[(stop + i - half + len) % len])
}
