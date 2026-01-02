export const GAME_CONFIG = {
  reelsVisibleRows: 4,
  maxLines: 5,

  maxCascades: 10,

  multiplierLadderBase: [1, 2, 3, 5],
  multiplierLadderFree: [1.2, 1.8, 2.5, 4],
  freeSpinsAwarded: 10,

  cascadeFillPool: [
    { kind: 'A' },
    { kind: 'K' },
    { kind: 'Q' },
    { kind: 'J' },
    { kind: 'SPADE' },
    { kind: 'HEART' },
    { kind: 'DIAMOND' },
    { kind: 'CLUB' },
  ],

  devForceScatterChance: 0,
}
