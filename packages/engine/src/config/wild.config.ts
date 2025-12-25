// src/config/wild.config.ts

export const RED_WILD_CHANCE = 0.09
export const MAX_RED_PROPAGATION = 2

// DEV — force every gold → red wild (demo only)
export const DEV_FORCE_RED_WILD = false

export const RED_PROPAGATION_DIRS = [
  { dx: 1, dy: 0 }, // RIGHT
  { dx: 0, dy: 1 }, // DOWN
]

export const BLOCKED_RED_WILD_KINDS = new Set(['SCATTER', 'WILD'])
