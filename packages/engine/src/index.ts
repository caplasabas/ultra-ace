// src/index.ts

// ─────────────────────────────────────────────
// Public runtime API
// ─────────────────────────────────────────────
export { spin } from './spin'
export { createRNG } from './rng'

// ─────────────────────────────────────────────
// Game configuration / constants
// ─────────────────────────────────────────────
export { REELS } from './math'

// ─────────────────────────────────────────────
// Types (no runtime cost)
// ─────────────────────────────────────────────
export type { SpinInput, SpinOutcome, CascadeStep, LineWin, Symbol } from './types'
