import seedrandom from "seedrandom";

export type PRNG = () => number

export function createRNG(seed: string): PRNG {
  const rng = seedrandom(seed)
  return () => rng()
}
