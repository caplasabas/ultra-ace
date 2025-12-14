import { PRNG } from '../rng'

export function gamble(
  rng: PRNG,
  win: number
): number {
  return rng() < 0.5 ? win * 2 : 0
}
