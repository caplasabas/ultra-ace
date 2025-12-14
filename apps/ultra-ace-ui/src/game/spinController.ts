import type { SpinInput } from '@ultra-ace/engine'
import { runSpin } from './engineAdapter'
import { mapOutcomeToVisualResult } from './reelMath'
import type { VisualSpinResult } from './types'

export function executeSpin(input: SpinInput): VisualSpinResult {
  const outcome = runSpin(input)

  const winningPaylines = outcome.lineWins.map(lw => lw.lineIndex)

  const base = mapOutcomeToVisualResult(outcome, winningPaylines)

  return {
    ...base,
    debug: {
      seed: new Date().toISOString(),
      reelStops: outcome.reelStops,
      bet: outcome.bet,
      win: outcome.win,
    },
  }
}
