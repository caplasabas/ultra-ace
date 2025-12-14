import { REELS } from './reels'
import { PAYLINES } from './paylines'
import { PAYTABLE } from './symbols'
import { Symbol, LineSymbol } from '../types/symbol'
import { SCATTER_CONFIG } from '../config/scatter.config'

export interface LineWin {
  lineIndex: number
  symbol: LineSymbol
  count: number
  payout: number
  positions: { reel: number; row: number }[]
}

export interface ScatterResult {
  count: number
  positions: { reel: number; row: number }[]
  freeSpins: number
}

export interface EvalResult {
  window: Symbol[][]
  win: number
  lineWins: LineWin[]
  scatter: ScatterResult
}

export function evaluateSpin(
  reelStops: number[],
  betPerLine: number,
  activeLines: number,
  rows: number,
): EvalResult {
  // Build visible window
  const window: Symbol[][] = REELS.map((reel, i) => buildWindow(reel, reelStops[i], rows))

  // --- SCATTER COUNT ---
  let scatterCount = 0
  const scatterPositions: { reel: number; row: number }[] = []

  for (let reelIndex = 0; reelIndex < window.length; reelIndex++) {
    if (!SCATTER_CONFIG.reels.includes(reelIndex)) continue

    for (let row = 0; row < window[reelIndex].length; row++) {
      if (window[reelIndex][row] === 'SCATTER') {
        scatterCount++
        scatterPositions.push({ reel: reelIndex, row })
      }
    }
  }

  let freeSpinsAwarded = 0
  if (scatterCount >= 3) {
    freeSpinsAwarded = SCATTER_CONFIG.freeSpins[scatterCount] ?? 0
  }

  const lineWins: LineWin[] = []

  for (let lineIndex = 0; lineIndex < activeLines; lineIndex++) {
    const line = PAYLINES[lineIndex]

    const positions = line.map((row, reelIndex) => ({
      reel: reelIndex,
      row,
    }))

    const symbols = positions.map(p => window[p.reel][p.row])

    const base = symbols[0]

    // Scatter and Wild never start a line
    if (base === 'SCATTER' || base === 'WILD') continue

    const pay = PAYTABLE[base as LineSymbol]
    if (!pay) continue

    let count = 1
    for (let i = 1; i < symbols.length; i++) {
      if (symbols[i] === base || symbols[i] === 'WILD') {
        count++
      } else {
        break
      }
    }

    if (count >= 3) {
      const payout = pay[count - 1] * betPerLine

      lineWins.push({
        lineIndex,
        symbol: base as LineSymbol,
        count,
        payout,
        positions: positions.slice(0, count),
      })
    }
  }

  const totalWin = lineWins.reduce((sum, lw) => sum + lw.payout, 0)

  return {
    window,
    win: totalWin,
    lineWins,
    scatter: {
      count: scatterCount,
      positions: scatterPositions,
      freeSpins: freeSpinsAwarded,
    },
  }
}

function buildWindow(reel: Symbol[], stop: number, rows: number): Symbol[] {
  const len = reel.length
  const half = Math.floor(rows / 2)

  return Array.from({ length: rows }, (_, i) => {
    const offset = i - half
    return reel[(stop + offset + len) % len]
  })
}
