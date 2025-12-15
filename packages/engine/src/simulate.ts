// src/simulate.ts

import { createRNG } from './rng'
import { spin } from './spin'
import { SIMULATION_CONFIG } from './config/simulate.config'

const { spins, betPerSpin, seed } = SIMULATION_CONFIG
const rng = createRNG(seed)

const symbolRtp: Record<string, number> = {}

let totalBet = 0
let totalWin = 0
let hitCount = 0
let maxWin = 0

for (let i = 0; i < spins; i++) {
  const outcome = spin(rng, {
    betPerLine: betPerSpin,
    lines: 20,
  })

  totalBet += outcome.bet
  totalWin += outcome.win

  if (outcome.win > 0) {
    hitCount++
    maxWin = Math.max(maxWin, outcome.win)
  }

  for (const lw of outcome.lineWins) {
    symbolRtp[lw.symbol] = (symbolRtp[lw.symbol] || 0) + lw.payout
  }
}

const rtp = totalBet > 0 ? totalWin / totalBet : 0

const symbolRtpPct: Record<string, string> = {}
for (const s in symbolRtp) {
  symbolRtpPct[s] = ((symbolRtp[s] / totalBet) * 100).toFixed(2) + '%'
}

console.log({
  spins,
  totalBet,
  totalWin,
  rtp: `${(rtp * 100).toFixed(2)}%`,
  hitRate: `${((hitCount / spins) * 100).toFixed(2)}%`,
  maxWin,
  symbolRtp: symbolRtpPct,
})

if (rtp < 0.9 || rtp > 0.97) {
  throw new Error(`RTP out of bounds: ${(rtp * 100).toFixed(2)}%`)
}
