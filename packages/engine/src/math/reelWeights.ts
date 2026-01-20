import { SymbolKind } from '../types/symbol.js'

export const REEL_WEIGHTS: Partial<Record<SymbolKind, number>> = {
  DIAMOND: 0.65,
  CLUB: 0.65,
  SPADE: 0.5,
  HEART: 0.5,

  J: 0.4,
  Q: 0.25,
  K: 0.15,
  A: 0.08,
  // DIAMOND: 1.6,
  // CLUB: 1.6,
  // SPADE: 1.2,
  // HEART: 1.2,
  //
  // J: 0.48,
  // Q: 0.32,
  // K: 0.18,
  // A: 0.12,

  WILD: 0,
  SCATTER: 0.06,
  // SCATTER: 1.2,
}

export const REEL_WEIGHTS_FREE: Partial<Record<SymbolKind, number>> = {
  SPADE: 0.9,
  HEART: 0.9,
  DIAMOND: 0.8,
  CLUB: 0.8,

  J: 0.3,
  Q: 0.18,
  K: 0.1,
  A: 0.05,

  WILD: 0,
  SCATTER: 0.02,
  // SPADE: 1.3,
  // HEART: 1.3,
  // DIAMOND: 0.95,
  // CLUB: 0.95,
  //
  // J: 0.35,
  // Q: 0.22,
  // K: 0.12,
  // A: 0.04,
  //
  // WILD: 0,
  // SCATTER: 0.025,
  // SCATTER: 0.9,
}

export const SYMBOL_REEL_CAPS: Partial<Record<SymbolKind, number>> = {
  A: 2,
  K: 3,
  Q: 4,
  J: 5,
  HEART: 5,
  SPADE: 5,
  CLUB: 6,
  DIAMOND: 6,
}

export const REFILL_WEIGHTS: Partial<Record<SymbolKind, number>> = {
  DIAMOND: 0.22,
  CLUB: 0.22,
  SPADE: 0.2,
  HEART: 0.2,

  J: 0.08,
  Q: 0.04,
  K: 0.025,
  A: 0.015,

  WILD: 0,
  SCATTER: 0,
}

export const SYMBOL_COLUMN_CAPS: Partial<Record<SymbolKind, number>> = {
  A: 1,
  K: 1,
  Q: 2,
  J: 2,
  HEART: 2,
  SPADE: 2,
  CLUB: 2,
  DIAMOND: 2,
}
