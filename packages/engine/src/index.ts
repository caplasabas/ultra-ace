// src/index.ts

// ─────────────────────────────────────────────
// Public runtime API
// ─────────────────────────────────────────────
export { spin } from './spin.js'
export { createRNG } from './rng.js'

export { formatPeso } from './utils'
// ─────────────────────────────────────────────
// Game configuration / constants
// ─────────────────────────────────────────────
export { REELS } from './math'

// ─────────────────────────────────────────────
// Types (no runtime cost)
// ─────────────────────────────────────────────
export type { SpinInput, SpinOutcome, CascadeStep, LineWin, Symbol } from './types'
