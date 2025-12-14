export class RTPController {
  private totalBet = 0
  private totalWin = 0

  constructor(private readonly targetRTP: number) {}

  registerSpin(bet: number, win: number) {
    this.totalBet += bet
    this.totalWin += win
  }

  get currentRTP() {
    if (this.totalBet === 0) return 0
    return this.totalWin / this.totalBet
  }

  allowHighWin(): boolean {
    // Soft guardrail
    return this.currentRTP < this.targetRTP
  }
}
