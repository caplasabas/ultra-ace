import type { SpinOutcome } from '@ultra-ace/engine'
import type { VisualReel, VisualSpinResult } from './types'
import { VISIBLE_ROWS } from '@constants/layout'

import { REELS } from '@ultra-ace/engine'

/**
 * Number of extra symbols above and below the visible window
 * so the reel can spin without showing edges.
 */
const BUFFER_ROWS = 6

export function mapOutcomeToVisualResult(
  outcome: SpinOutcome
): VisualSpinResult {
  const reels: VisualReel[] = outcome.reelStops.map(
    (stopIndex, reelIndex) => {
      const reelStrip = REELS[reelIndex]

      // Final visible symbols based on engine stop
      const visibleSymbols = getVisibleSymbols(
        reelStrip,
        stopIndex,
        VISIBLE_ROWS
      )

      const bufferTop = generateBufferSymbols(reelStrip, BUFFER_ROWS)
      const bufferBottom = generateBufferSymbols(reelStrip, BUFFER_ROWS)

      return {
        symbols: [
          ...bufferTop,
          ...visibleSymbols,
          ...bufferBottom
        ],
        stopIndex: bufferTop.length
      }
    }
  )

  return { reels, outcome }
}

/**
 * Extract visible symbols from a circular reel strip
 */
function getVisibleSymbols(
  reel: readonly string[],
  stopIndex: number,
  rows: number
): string[] {
  return Array.from({ length: rows }, (_, i) => {
    const idx = (stopIndex + i) % reel.length
    return reel[idx]
  })
}

/**
 * Generate buffer symbols using the same reel strip
 * so symbol frequency stays realistic
 */
function generateBufferSymbols(
  reel: readonly string[],
  count: number
): string[] {
  return Array.from({ length: count }, () => {
    const idx = Math.floor(Math.random() * reel.length)
    return reel[idx]
  })
}
