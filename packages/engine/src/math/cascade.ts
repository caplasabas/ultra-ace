import { Symbol } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateColumnWindow } from './evaluator.columns.js'
import { GAME_CONFIG } from '../config/game.config.js'
import { getCascadeMultiplier } from './multiplier.js'
import {
  RED_WILD_CHANCE,
  FREE_RED_WILD_CHANCE,
  BIG_JOKER_MIN,
  BIG_JOKER_MAX,
  DEV_FORCE_RED_WILD,
  DEV_FORCE_BIG_JOKER,
  BLOCKED_JOKER_KINDS,
} from '../config/wild.config.js'

/* ----------------------------------------
   CONSTANTS
---------------------------------------- */
const GOLD_CHANCE_REFILL = 0.025
const FREE_GOLD_CHANCE_REFILL = 0.055

const GOLD_TTL = 0
const MAX_PAYOUT = 2_000_000
const MAX_MULTIPLIER = 10_000
const MAX_SAME_SYMBOL_PER_REEL = 20

/* ----------------------------------------
   HELPERS
---------------------------------------- */
function makeInitialCascade(window: Symbol[][]): CascadeStep {
  return {
    index: 0,
    multiplier: 1,
    lineWins: [],
    win: 0,
    removedPositions: [],
    isScatterTerminal: false,
    window: cloneWindow(window),
  }
}

/* ----------------------------------------
   MAIN
---------------------------------------- */
export function runCascades(
  initialWindow: Symbol[][],
  totalBet: number,
  isFreeGame: boolean,
  isForceScatter: boolean,
  rng: () => number,
) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  cascades.push(makeInitialCascade(window))

  for (let i = 1; i <= GAME_CONFIG.maxCascades; i++) {
    const multiplier = getCascadeMultiplier(
      i,
      isFreeGame,
      GAME_CONFIG.multiplierLadderBase,
      GAME_CONFIG.multiplierLadderFree,
    )

    if (multiplier >= MAX_MULTIPLIER) break

    const { wins } = evaluateColumnWindow(window, totalBet)

    /* ----------------------------------------
       NO MORE LINE WINS → POSSIBLE SCATTER TERMINAL
    ---------------------------------------- */
    // if (wins.length === 0) {
    // const scatterCount = window.flat().filter(s => s.kind === 'SCATTER').length

    // if (scatterCount >= 3) {
    //   cascades.push({
    //     index: i,
    //     multiplier,
    //     lineWins: [],
    //     win: 0,
    //     removedPositions: [],
    //     isScatterTerminal: true,
    //     window: cloneWindow(cascades[cascades.length - 1].window), // 🔒 post-pop, pre-refill
    //   })
    // }

    //   break
    // }

    /* ----------------------------------------
       APPLY LINE WINS
    ---------------------------------------- */
    const removedSet = new Set<string>()
    const removed: { reel: number; row: number }[] = []
    let baseWin = 0

    function markForRemoval(pos: { reel: number; row: number }) {
      const key = `${pos.reel}-${pos.row}`
      if (removedSet.has(key)) return
      removedSet.add(key)
      removed.push(pos)
    }

    for (const w of wins) {
      baseWin += w.payout

      for (const pos of w.positions) {
        const s = window[pos.reel][pos.row]
        const isEdge = pos.reel === 0

        markForRemoval(pos)

        // Edge reel always empties
        if (isEdge) {
          window[pos.reel][pos.row] = { kind: 'EMPTY' }
          continue
        }

        // Gold → Wild
        if (s.isGold) {
          const redChance = isFreeGame ? FREE_RED_WILD_CHANCE : RED_WILD_CHANCE
          const isRed = DEV_FORCE_RED_WILD || DEV_FORCE_BIG_JOKER || rng() < redChance

          window[pos.reel][pos.row] = {
            kind: 'WILD',
            isWild: true,
            wildColor: isRed ? 'red' : 'blue',
            fromGold: true,
          }

          if (isRed) propagateBigJoker(window, rng)
          continue
        }

        // Normal symbol
        window[pos.reel][pos.row] = { kind: 'EMPTY' }
      }
    }

    const win = baseWin * multiplier
    totalWin += win
    if (totalWin >= MAX_PAYOUT) break

    // /* ----------------------------------------
    //    CHECK FOR SCATTER TERMINAL AFTER POP
    // ---------------------------------------- */
    // const scatterCountAfterPop = window.flat().filter(s => s.kind === 'SCATTER').length
    //
    // const isScatterTerminalNext = scatterCountAfterPop >= 3
    //
    // // Capture post-pop window BEFORE refill
    // const postPopWindow = cloneWindow(window)

    refillInPlace(window, rng, isFreeGame)

    cascades.push({
      index: i,
      multiplier,
      lineWins: wins,
      win,
      removedPositions: removed,
      isScatterTerminal: false,
      window: cloneWindow(window),
    })

    // if (isScatterTerminalNext) {
    //   cascades.push({
    //     index: i + 1,
    //     multiplier,
    //     lineWins: [],
    //     win: 0,
    //     removedPositions: removed,
    //     isScatterTerminal: true,
    //     window: postPopWindow, // 🔒 BLANKS PRESERVED
    //   })
    //   break
    // }
  }

  return { totalWin, cascades }
}

/* ----------------------------------------
   BIG JOKER (RED WILD PROPAGATION)
---------------------------------------- */
function propagateBigJoker(window: Symbol[][], rng: () => number) {
  const candidates: { reel: number; row: number }[] = []

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

/* ----------------------------------------
   REFILL
---------------------------------------- */
function refillInPlace(window: Symbol[][], rng: () => number, isFreeGame: boolean) {
  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      if (window[r][row].kind !== 'EMPTY') continue

      let symbol: Symbol
      let attempts = 0

      do {
        symbol = {
          ...GAME_CONFIG.cascadeFillPool[Math.floor(rng() * GAME_CONFIG.cascadeFillPool.length)],
        }
        attempts++

        const sameKindCount = window[r].filter(s => s.kind === symbol.kind).length

        if (symbol.kind !== 'WILD' && sameKindCount < MAX_SAME_SYMBOL_PER_REEL) break
      } while (attempts < 20)

      const goldAllowed = r !== 0 && r !== window.length - 1
      const goldChance = isFreeGame ? FREE_GOLD_CHANCE_REFILL : GOLD_CHANCE_REFILL

      if (goldAllowed && symbol.kind !== 'SCATTER' && rng() < goldChance) {
        symbol.isGold = true
        symbol.goldTTL = GOLD_TTL
      }

      window[r][row] = symbol
    }
  }
}

/* ----------------------------------------
   UTILS
---------------------------------------- */
function cloneWindow(w: Symbol[][]): Symbol[][] {
  return w.map(col => col.map(s => ({ ...s })))
}

function shuffle<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
