import { Symbol, SymbolKind } from '../types/symbol.js'
import { CascadeStep } from '../types/cascade.js'
import { evaluateColumnWindow, Position } from './evaluator.columns.js'
import { GAME_CONFIG } from '../config/game.config.js'
import { getCascadeMultiplier } from './multiplier.js'
import {
  DEV_FORCE_RED_WILD,
  DEV_FORCE_BIG_JOKER,
  BLOCKED_JOKER_KINDS,
} from '../config/wild.config.js'
import { EngineConfig } from '../runtime/engineConfig.js'

const HAPPY_GOLD_ELIGIBLE = new Set<SymbolKind>(['A', 'K', 'Q', 'J'])

function isGoldEligible(kind: SymbolKind, isHappyHour: boolean): boolean {
  if (kind === 'SCATTER') return false
  if (!isHappyHour) return true
  return HAPPY_GOLD_ELIGIBLE.has(kind)
}

export function runCascades(
  cfg: EngineConfig,
  initialWindow: Symbol[][],
  totalBet: number,
  isFreeGame: boolean,
  freeSpinSource: 'natural' | 'buy',
  rng: () => number,
) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  cascades.push(makeInitialCascade(window))

  for (let i = 1; i <= cfg.cascades.maxCascades; i++) {
    const multiplier = getCascadeMultiplier(
      i,
      isFreeGame,
      cfg.cascades.multiplierLadderBase,
      cfg.cascades.multiplierLadderFree,
    )

    if (multiplier >= cfg.limits.maxMultiplier) break

    const { wins } = evaluateColumnWindow(window, totalBet)
    // Stop cascade chain as soon as there are no line wins.
    // Keeping empty cascades causes UI timeline loops (notably on scatter tease).
    if (wins.length === 0) break

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
          const redChance = isFreeGame ? cfg.gold.freeRedWildChance : cfg.gold.redWildChance
          const isRed = DEV_FORCE_RED_WILD || DEV_FORCE_BIG_JOKER || rng() < redChance

          window[pos.reel][pos.row] = {
            kind: 'WILD',
            isWild: true,
            wildColor: isRed ? 'red' : 'blue',
            fromGold: true,
          }

          if (isRed) propagateBigJoker(cfg, window, rng)
          continue
        }

        // Normal symbol
        window[pos.reel][pos.row] = { kind: 'EMPTY' }
      }
    }

    const win = baseWin * multiplier
    totalWin += win
    if (totalWin >= cfg.limits.maxPayout) break

    const winningSymbolMap = buildWinningSymbolMap(wins)

    refillInPlace(cfg, window, rng, isFreeGame, freeSpinSource, winningSymbolMap)

    cascades.push({
      index: i,
      multiplier,
      lineWins: wins,
      win,
      removedPositions: removed,
      isScatterTerminal: false,
      window: cloneWindow(window),
    })
  }

  return { totalWin, cascades }
}

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
   BIG JOKER (RED WILD PROPAGATION)
---------------------------------------- */
function propagateBigJoker(cfg: EngineConfig, window: Symbol[][], rng: () => number) {
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

  const count = cfg.joker.min + Math.floor(rng() * (cfg.joker.max - cfg.joker.min + 1))

  for (let i = 0; i < Math.min(count, candidates.length); i++) {
    const { reel, row } = candidates[i]
    window[reel][row] = {
      kind: 'WILD',
      isWild: true,
      wildColor: 'red',
    }
  }
}

function refillInPlace(
  cfg: EngineConfig,
  window: Symbol[][],
  rng: () => number,
  isFreeGame: boolean,
  freeSpinSource: 'natural' | 'buy',
  winningSymbolMap: Map<SymbolKind, number>,
) {
  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      if (window[r][row].kind !== 'EMPTY') continue

      let symbol: Symbol
      let attempts = 0

      do {
        symbol =
          r === 0
            ? pickWeightedSymbol(
                cfg,
                GAME_CONFIG.cascadeFillPool.filter(
                  s => s.kind === 'A' || s.kind === 'K' || s.kind === 'Q',
                ),
                winningSymbolMap,
                rng,
              )
            : {
                ...pickWeightedSymbol(cfg, GAME_CONFIG.cascadeFillPool, winningSymbolMap, rng),
              }

        attempts++

        const sameColumnCount = window.filter(col => col[row]?.kind === symbol.kind).length

        const columnCap = cfg.caps.column[symbol.kind]
        if (columnCap !== undefined && sameColumnCount >= columnCap && cfg.mode === 'NORMAL') {
          continue
        }

        const sameKindCount = window[r].filter(s => s.kind === symbol.kind).length

        const rowCap = cfg.caps.reel[symbol.kind]
        if (rowCap !== undefined && sameKindCount >= rowCap && cfg.mode === 'NORMAL') {
          continue
        }
        if (symbol.kind !== 'WILD' && sameKindCount < cfg.cascades.maxSameSymbolPerReel) break
      } while (attempts < 20)

      const goldAllowed = r !== 0 && r !== window.length - 1
      const baseFreeRefillChance =
        freeSpinSource === 'natural'
          ? cfg.gold.freeRefillChance * cfg.gold.naturalFreeRefillBoost
          : cfg.gold.freeRefillChance
      const goldChance = isFreeGame || cfg.mode === 'HAPPY_HOUR' ? baseFreeRefillChance : cfg.gold.refillChance

      if (goldAllowed && isGoldEligible(symbol.kind, cfg.mode === 'HAPPY_HOUR') && rng() < goldChance) {
        symbol.isGold = true
        symbol.goldTTL = cfg.gold.ttl
      }

      window[r][row] = symbol
    }
  }
}

function weightedRandom<T>(items: { symbol: T; weight: number }[], rng: () => number): T {
  const total = items.reduce((s, i) => s + i.weight, 0)
  let roll = rng() * total

  for (const i of items) {
    roll -= i.weight
    if (roll <= 0) return i.symbol
  }

  return items[items.length - 1].symbol
}

function pickWeightedSymbol(
  cfg: EngineConfig,
  pool: Symbol[],
  winningMap: Map<SymbolKind, number>,
  rng: () => number,
): Symbol {
  const weighted = pool.map(s => {
    const baseWeight =
      cfg.mode === 'HAPPY_HOUR'
        ? (cfg.reels.refillWeightsFree[s.kind] ?? 0.1)
        : (cfg.reels.refillWeights[s.kind] ?? 0.015)
    const penalty =
      cfg.mode === 'HAPPY_HOUR'
        ? happySymbolReinforcementPenalty(winningMap.get(s.kind) ?? 0)
        : symbolReinforcementPenalty(winningMap.get(s.kind) ?? 0)
    return {
      symbol: s,
      weight: baseWeight * penalty,
    }
  })

  return { ...weightedRandom(weighted, rng) }
}

function buildWinningSymbolMap(
  wins: {
    symbol: SymbolKind
    reels: number
    count: number
    payout: number
    positions: Position[]
  }[],
): Map<SymbolKind, number> {
  const map = new Map<SymbolKind, number>()

  for (const w of wins) {
    map.set(w.symbol, (map.get(w.symbol) ?? 0) + w.positions.length)
  }

  return map
}

function symbolReinforcementPenalty(count: number): number {
  if (count <= 3) return 1.0
  if (count === 4) return 0.65
  if (count === 5) return 0.35
  return 0.2
}

function happySymbolReinforcementPenalty(count: number): number {
  if (count <= 3) return 1.0
  if (count === 4) return 0.94
  if (count === 5) return 0.84
  return 0.74
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
