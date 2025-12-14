import { REELS } from './reels'
import { PAYLINES } from './paylines'
import { PAYTABLE } from './symbols'
import { Symbol } from '../types/symbol'
import { LineWin } from '../types/spin'

export interface EvalResult {
  window: Symbol[][]
  win: number
  scatterCount: number
  lineWins: LineWin[]
}

const LINE_DAMPENING = [1, 0.8, 0.6, 0.4, 0.25]

export function evaluateSpin(
  reelStops: number[],
  betPerLine: number,
  activeLines: number,
  isFreeGame: boolean
): EvalResult {

  // Build 5x3 window
  const window: Symbol[][] = REELS.map((reel, i) => {
    const stop = reelStops[i]
    const len = reel.length
    return [
      reel[(stop - 1 + len) % len],
      reel[stop],
      reel[(stop + 1) % len],
    ]
  })

  let scatterCount = 0
  const lineWins: LineWin[] = []

  // Count scatters anywhere
  for (const reel of window) {
    for (const s of reel) {
      if (s === 'SCATTER') scatterCount++
    }
  }

  // Evaluate paylines
  for (let lineIndex = 0; lineIndex < activeLines; lineIndex++) {
    const line = PAYLINES[lineIndex]

    const symbols = line.map(
      (row, reelIndex) => window[reelIndex][row]
    )

    const base = symbols[0]
    if (base === 'WILD' || base === 'SCATTER') continue

    const pay = PAYTABLE[base]
    if (!pay) continue

    let count = 1
    for (let i = 1; i < symbols.length; i++) {
      const s = symbols[i]
      if (s === base || s === 'WILD') count++
      else break
    }

    if (count >= 3) {
      const rawPayout = pay[count - 1] * betPerLine
      if (rawPayout <= 0) continue

      lineWins.push({
        lineIndex,
        symbol: base,
        count,
        payout: rawPayout,
      })
    }
  }

  const TARGET_RTP = 0.92
  const BASELINE_RTP = 0.61
  const RTP_SCALAR = TARGET_RTP / BASELINE_RTP

  let totalWin = 0
  lineWins.forEach((lw, idx) => {
    const factor = LINE_DAMPENING[idx] ?? 0.15
    lw.payout = Math.floor(lw.payout * factor)
    totalWin += Math.floor(lw.payout * RTP_SCALAR)
  })

  return {
    window,
    win: totalWin,
    scatterCount,
    lineWins,
  }
}
