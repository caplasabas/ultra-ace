export const RED_WILD_CHANCE = 0.12
export const FREE_RED_WILD_CHANCE = 0.35

// Big Joker replaces 1–4 symbols
export const BIG_JOKER_MIN = 1
export const BIG_JOKER_MAX = 4

// Debug flags
export const DEV_FORCE_RED_WILD = false
export const DEV_FORCE_BIG_JOKER = false
export const DEV_FORCE_FREE_RETRIGGER = false

// Big Joker cannot overwrite these
export const BLOCKED_JOKER_KINDS = new Set(['SCATTER', 'WILD'])
