import { Symbol } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateColumnWindow } from './evaluator.columns.js'
import { GAME_CONFIG } from '../config/game.config.js'
import { getCascadeMultiplier } from './multiplier.js'
import {
  RED_WILD_CHANCE,
  BIG_JOKER_MIN,
  BIG_JOKER_MAX,
  DEV_FORCE_RED_WILD,
  DEV_FORCE_BIG_JOKER,
  BLOCKED_JOKER_KINDS,
} from '../config/wild.config.js'

const GOLD_CHANCE_REFILL = 0.7
// const GOLD_CHANCE_REFILL = 0.02

const GOLD_TTL = 0
const MAX_PAYOUT = 2_000_000
const MAX_MULTIPLIER = 10_000

export function runCascades(
  initialWindow: Symbol[][],
  totalBet: number,
  isFreeGame: boolean,
  rng: () => number,
) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  cascades.push({
    index: 0,
    multiplier: 1,
    lineWins: [],
    win: 0,
    removedPositions: [],
    window: cloneWindow(window),
  })

  for (let i = 1; i <= GAME_CONFIG.maxCascades; i++) {
    const multiplier = getCascadeMultiplier(
      i,
      isFreeGame,
      GAME_CONFIG.multiplierLadderBase,
      GAME_CONFIG.multiplierLadderFree,
    )

    if (multiplier >= MAX_MULTIPLIER) break

    const { wins } = evaluateColumnWindow(window, totalBet)
    if (wins.length === 0) break

    const removedSet = new Set<string>()
    const removed: { reel: number; row: number }[] = []
    let baseWin = 0

    const wildTriggered = wins.some(w =>
      w.positions.some(p => window[p.reel][p.row].kind === 'WILD'),
    )

    /* ───────── PROMOTE ALL WILDS TO WINNERS ───────── */

    if (wildTriggered) {
      const wildPositions: { reel: number; row: number }[] = []

      for (let reel = 0; reel < window.length; reel++) {
        for (let row = 0; row < window[reel].length; row++) {
          if (window[reel][row].kind === 'WILD') {
            wildPositions.push({ reel, row })
          }
        }
      }

      // 👑 Inject synthetic win group (NO payout)
      wins.push({
        symbol: 'WILD',
        count: wildPositions.length,
        payout: 0,
        positions: wildPositions,
      })
    }

    function markForRemoval(pos: { reel: number; row: number }) {
      const key = `${pos.reel}-${pos.row}`
      if (removedSet.has(key)) return
      removedSet.add(key)
      removed.push(pos)
    }

    /* ───────── PROCESS ALL WIN GROUPS ───────── */

    for (const w of wins) {
      baseWin += w.payout

      for (const pos of w.positions) {
        const s = window[pos.reel][pos.row]
        const isEdge = pos.reel === 0 || pos.reel === window.length - 1

        markForRemoval(pos)

        if (isEdge) {
          window[pos.reel][pos.row] = { kind: 'EMPTY' }
          continue
        }

        if (s.isGold) {
          const isRed = DEV_FORCE_RED_WILD || DEV_FORCE_BIG_JOKER || rng() < RED_WILD_CHANCE

          window[pos.reel][pos.row] = {
            kind: 'WILD',
            isWild: true,
            wildColor: isRed ? 'red' : 'blue',
            fromGold: true,
          }

          if (isRed) propagateBigJoker(window, rng)
          continue
        }

        window[pos.reel][pos.row] = { kind: 'EMPTY' }
      }
    }

    const win = baseWin * multiplier
    totalWin += win
    if (totalWin >= MAX_PAYOUT) break

    refillInPlace(window, rng)

    cascades.push({
      index: i,
      multiplier,
      lineWins: wins,
      win,
      removedPositions: removed,
      window: cloneWindow(window),
    })
  }

  return { totalWin, cascades }
}

/* ───────── BIG JOKER (RED WILD PROPAGATION) ───────── */

function propagateBigJoker(window: Symbol[][], rng: () => number) {
  const candidates: { reel: number; row: number }[] = []

  // 🔒 STRICT: ONLY REELS 1–3
  for (let reel = 1; reel <= 3; reel++) {
    for (let row = 0; row < window[reel].length; row++) {
      const s = window[reel][row]
      if (s.kind !== 'WILD' && !BLOCKED_JOKER_KINDS.has(s.kind)) {
        candidates.push({ reel, row })
      }
    }
  }

  shuffle(candidates, rng)

  const count = BIG_JOKER_MIN + Math.floor(rng() * (BIG_JOKER_MAX - BIG_JOKER_MIN + 1))

  for (let i = 0; i < Math.min(count, candidates.length); i++) {
    const { reel, row } = candidates[i]
    window[reel][row] = {
      kind: 'WILD',
      isWild: true,
      wildColor: 'red',
    }
  }
}

/* ───────── REFILL ───────── */

function refillInPlace(window: Symbol[][], rng: () => number) {
  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      if (window[r][row].kind !== 'EMPTY') continue

      const symbol: Symbol = {
        ...GAME_CONFIG.cascadeFillPool[Math.floor(rng() * GAME_CONFIG.cascadeFillPool.length)],
      }

      const goldAllowed = r !== 0 && r !== window.length - 1

      if (goldAllowed && symbol.kind !== 'SCATTER' && rng() < GOLD_CHANCE_REFILL) {
        symbol.isGold = true
        symbol.goldTTL = GOLD_TTL
      }

      window[r][row] = symbol
    }
  }
}

/* ───────── UTILS ───────── */

function cloneWindow(w: Symbol[][]): Symbol[][] {
  return w.map(col => col.map(s => ({ ...s })))
}

function shuffle<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
