import type { SpinInput } from '@ultra-ace/engine'
import { runSpin } from './engineAdapter'
import { mapOutcomeToVisualResult } from './reelMath'
import type { VisualSpinResult } from './types'

export function executeSpin(input: SpinInput): VisualSpinResult {
  const outcome = runSpin(input)
  const base = mapOutcomeToVisualResult(outcome)

  return {
    ...base,
    lineWins: outcome.lineWins.map(lw => ({
      lineIndex: lw.lineIndex,
      positions: lw.positions,
    })),
    debug: {
      seed: new Date().toISOString(),
      reelStops: outcome.reelStops,
      bet: outcome.bet,
      win: outcome.win,
    },
  }
}
