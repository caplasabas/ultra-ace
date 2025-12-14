import {
  spin,
  createRNG,
  type SpinInput,
  type SpinOutcome
} from '@ultra-ace/engine'

/**
 * Engine adapter owns the RNG lifecycle.
 * UI never touches RNG directly.
 */
export function runSpin(input: SpinInput): SpinOutcome {
  const seed =  Date.now().toString()

  const rng = createRNG(seed)

  return spin(rng, input)
}
