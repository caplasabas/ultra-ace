import type { SpinOutcome } from '@ultra-ace/engine'
import type { VisualReel, VisualSpinBase } from './types'
import { VISIBLE_ROWS } from '@constants/layout'

import { REELS } from '@ultra-ace/engine'

export function mapOutcomeToVisualResult(
  outcome: SpinOutcome,
  winningPaylines: number[],
): VisualSpinBase {
  const reels: VisualReel[] = outcome.reelStops.map((stopIndex, reelIndex) => {
    const reelStrip = REELS[reelIndex]

    const visibleSymbols = getVisibleSymbols(reelStrip, stopIndex, VISIBLE_ROWS)

    return {
      symbols: reelStrip,
      stopIndex,
      visible: visibleSymbols,
    }
  })

  return { reels, outcome, winningPaylines }
}

function getVisibleSymbols(reel: readonly string[], stopIndex: number, rows: number): string[] {
  return Array.from({ length: rows }, (_, i) => {
    const idx = (stopIndex + i) % reel.length
    return reel[idx]
  })
}
