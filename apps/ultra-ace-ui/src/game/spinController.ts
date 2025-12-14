import type { SpinInput } from '@ultra-ace/engine'
import { runSpin } from './engineAdapter'
import { mapOutcomeToVisualResult } from './reelMath'
import type { VisualSpinResult } from './types'

export function executeSpin(
  input: SpinInput
): VisualSpinResult {
  const outcome = runSpin(input)
  return mapOutcomeToVisualResult(outcome)
}
