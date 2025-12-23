// src/simulate.ts

import { spin } from './spin.js'
import { createRNG } from './rng.js'
import { SIMULATION_CONFIG } from './config/simulate.config.js'

const { spins, betPerSpin, seed, lines } = SIMULATION_CONFIG

const rng = createRNG(seed)

// 📊 Stats
let totalBet = 0
let totalWin = 0
let hitCount = 0
let maxWin = 0

const symbolRtp: Record<string, number> = {}

for (let i = 0; i < spins; i++) {
  const outcome = spin(rng, {
    betPerSpin,
    lines,
  })

  totalBet += outcome.bet
  totalWin += outcome.win

  if (outcome.win > 0) {
    hitCount++
    maxWin = Math.max(maxWin, outcome.win)
  }

  // ⚠️ CRITICAL: skip cascade index 0 (seed)
  for (const c of outcome.cascades ?? []) {
    if (c.index === 0) continue

    for (const lw of c.lineWins) {
      symbolRtp[lw.symbol] = (symbolRtp[lw.symbol] || 0) + lw.payout
    }
  }
}

// 📈 Final metrics
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

// // 🎯 TARGET BAND (commercial-feeling)
// if (rtp < 0.88 || rtp > 0.96) {
//   throw new Error(`RTP out of bounds: ${(rtp * 100).toFixed(2)}%`)
// }
