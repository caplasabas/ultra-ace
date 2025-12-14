export interface VisualReel {
  symbols: string[]
  stopIndex: number
}

export interface VisualSpinResult {
  reels: VisualReel[]
  outcome: {
    bet: number
    win: number
    reelStops: number[]
    lineWins: unknown[]
  }
}
