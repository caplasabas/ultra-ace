// src/simulate.ts
import { spin } from './spin.js'
import { createRNG } from './rng.js'
import { SIMULATION_CONFIG } from './config/simulate.config.js'

const { spins, betPerSpin, seed, lines } = SIMULATION_CONFIG
const rng = createRNG(seed)

// ───────────── Stats ─────────────
let totalBet = 0

let baseWin = 0
let freeWin = 0

let hitCount = 0
let maxWin = 0
let freeSpins = 0

const baseSymbolRtp: Record<string, number> = {}
const freeSymbolRtp: Record<string, number> = {}

for (let i = 0; i < spins; i++) {
  // ── BASE SPIN ──
  const outcome = spin(rng, {
    betPerSpin,
    lines,
    isFreeGame: false,
  })

  totalBet += outcome.bet
  baseWin += outcome.win

  if (outcome.win > 0) hitCount++
  maxWin = Math.max(maxWin, outcome.win)

  freeSpins += outcome.freeSpinsAwarded ?? 0

  for (const c of outcome.cascades ?? []) {
    for (const lw of c.lineWins) {
      baseSymbolRtp[lw.symbol] = (baseSymbolRtp[lw.symbol] || 0) + lw.payout * c.multiplier
    }
  }

  // ── FREE SPINS ──
  while (freeSpins > 0) {
    freeSpins--

    const fs = spin(rng, {
      betPerSpin,
      lines,
      isFreeGame: true,
    })

    freeWin += fs.win
    maxWin = Math.max(maxWin, fs.win)

    for (const c of fs.cascades ?? []) {
      for (const lw of c.lineWins) {
        freeSymbolRtp[lw.symbol] = (freeSymbolRtp[lw.symbol] || 0) + lw.payout * c.multiplier
      }
    }
  }
}

// ───────────── Final Metrics ─────────────
const totalWin = baseWin + freeWin
const baseRtp = baseWin / totalBet
const freeRtp = freeWin / totalBet
const totalRtp = totalWin / totalBet

function pct(v: number) {
  return ((v / totalBet) * 100).toFixed(2) + '%'
}

console.log({
  spins,
  totalBet,
  baseWin,
  freeWin,
  totalWin,
  baseRtp: `${(baseRtp * 100).toFixed(2)}%`,
  freeRtp: `${(freeRtp * 100).toFixed(2)}%`,
  totalRtp: `${(totalRtp * 100).toFixed(2)}%`,
  hitRate: `${((hitCount / spins) * 100).toFixed(2)}%`,
  maxWin,
  baseSymbolRtp: Object.fromEntries(Object.entries(baseSymbolRtp).map(([s, v]) => [s, pct(v)])),
  freeSymbolRtp: Object.fromEntries(Object.entries(freeSymbolRtp).map(([s, v]) => [s, pct(v)])),
})
