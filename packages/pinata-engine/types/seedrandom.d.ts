declare module "seedrandom" {
  interface PRNG {
    (): number
    quick(): number
    int32(): number
    double(): number
  }

  interface SeedRandom {
    (seed?: string | number, options?: { global?: boolean }): PRNG
  }

  const seedrandom: SeedRandom
  export = seedrandom
}
