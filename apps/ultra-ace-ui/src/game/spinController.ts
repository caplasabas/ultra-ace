import type { SpinInput } from '@ultra-ace/engine'
import { runSpin } from './engineAdapter'
import type { VisualSpinResult } from './types'

export function executeSpin(input: SpinInput): VisualSpinResult {
  const outcome = runSpin(input)

  return {
    outcome,
    reels: [], // reels are now derived per cascade in useSpin
    lineWins: [], // legacy compatibility (not used)
    debug: {
      seed: new Date().toISOString(),
      reelStops: outcome.reelStops,
      bet: outcome.bet,
      win: outcome.win,
    },
  }
}
