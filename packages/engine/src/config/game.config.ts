export const GAME_CONFIG = {
  reelsVisibleRows: 4,
  maxLines: 20,
  maxCascades: 10,

  multiplierLadder: [1, 1.5, 2.25, 3],

  // Base-game refill bias
  cascadeFillPool: [
    { kind: 'SPADE' },
    { kind: 'HEART' },
    { kind: 'DIAMOND' },
    { kind: 'CLUB' },
    { kind: 'J' },
    { kind: 'Q' },
    { kind: 'K' },
    { kind: 'A' },
  ],
}
