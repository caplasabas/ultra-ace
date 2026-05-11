import { Symbol, SymbolKind } from '../types/symbol.js'
import { CascadeStep, CollectedMultiplier, RefillSymbol } from '../types/cascade.js'
import { evaluatePaylineWindow, Position } from './evaluator.paylines.js'
import { GAME_CONFIG } from '../config/game.config.js'
import { EngineConfig } from '../runtime/engineConfig.js'

const HAPPY_GOLD_ELIGIBLE = new Set<SymbolKind>(['ACE', 'KING', 'QUEEN', 'JACK'])

function isGoldEligible(kind: SymbolKind, isHappyHour: boolean): boolean {
  if (kind === 'SCATTER') return false
  if (!isHappyHour) return true
  return HAPPY_GOLD_ELIGIBLE.has(kind)
}

function pickGoldMultiplier(cfg: EngineConfig, rng: () => number): number | undefined {
  if (rng() >= cfg.gold.multiplierChance) return undefined
  const values = cfg.gold.multiplierValues
  return values[Math.floor(rng() * values.length)]
}

export function runCascades(
  cfg: EngineConfig,
  initialWindow: Symbol[][],
  totalBet: number,
  isFreeGame: boolean,
  freeSpinSource: 'natural' | 'buy',
  rng: () => number,
  activeLines: number = 20,
) {
  const window = cloneWindow(initialWindow)
  let totalBaseWin = 0
  let collectedMultiplier = 0
  const cascades: CascadeStep[] = []

  cascades.push(makeInitialCascade(window))

  for (let i = 1; i <= cfg.cascades.maxCascades; i++) {
    const { wins } = evaluatePaylineWindow(window, totalBet, activeLines)
    // Stop cascade chain as soon as there are no line wins.
    // Keeping empty cascades causes UI timeline loops (notably on scatter tease).
    if (wins.length === 0) break

    /* ----------------------------------------
       APPLY LINE WINS
    ---------------------------------------- */
    const removedSet = new Set<string>()
    const removed: { reel: number; row: number }[] = []
    let baseWin = 0
    let cascadeCollectedMultiplier = 0
    const collectedMultipliers: CollectedMultiplier[] = []

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
          const value = s.goldMultiplier ?? 0
          if (value > 0) {
            cascadeCollectedMultiplier += value
            collectedMultipliers.push({
              reel: pos.reel,
              row: pos.row,
              value,
              symbol: s.kind,
            })
          }

          window[pos.reel][pos.row] = {
            kind: 'WILD',
            isWild: true,
            wildColor: 'blue',
            fromGold: true,
          }
          continue
        }

        // Normal symbol
        window[pos.reel][pos.row] = { kind: 'EMPTY' }
      }
    }

    totalBaseWin += baseWin
    collectedMultiplier += cascadeCollectedMultiplier

    const winningSymbolMap = buildWinningSymbolMap(wins)

    const { refillSymbols, topPreview } = collapseAndRefillInPlace(
      cfg,
      window,
      rng,
      isFreeGame,
      freeSpinSource,
      winningSymbolMap,
    )

    cascades.push({
      index: i,
      multiplier: 1,
      goldMultiplier: cascadeCollectedMultiplier || undefined,
      baseWin,
      collectedMultiplier: cascadeCollectedMultiplier || undefined,
      collectedMultipliers,
      lineWins: wins,
      win: baseWin,
      removedPositions: removed,
      refillSymbols,
      topPreview,
      isScatterTerminal: false,
      window: cloneWindow(window),
    })
  }

  return { totalBaseWin, collectedMultiplier, cascades }
}

/* ----------------------------------------
   HELPERS
---------------------------------------- */
function makeInitialCascade(window: Symbol[][]): CascadeStep {
  return {
    index: 0,
    multiplier: 1,
    baseWin: 0,
    collectedMultiplier: 0,
    collectedMultipliers: [],
    lineWins: [],
    win: 0,
    removedPositions: [],
    refillSymbols: [],
    topPreview: window.map(() => []),
    isScatterTerminal: false,
    window: cloneWindow(window),
  }
}

function collapseAndRefillInPlace(
  cfg: EngineConfig,
  window: Symbol[][],
  rng: () => number,
  isFreeGame: boolean,
  freeSpinSource: 'natural' | 'buy',
  winningSymbolMap: Map<SymbolKind, number>,
): { refillSymbols: RefillSymbol[]; topPreview: Symbol[][] } {
  const refillSymbols: RefillSymbol[] = []
  const topPreview: Symbol[][] = window.map(() => [])

  for (let r = 0; r < window.length; r++) {
    const reel = window[r]
    const survivors = reel.filter(s => s.kind !== 'EMPTY').map(s => ({ ...s }))
    const emptyCount = reel.length - survivors.length
    const newSymbols: Symbol[] = []

    for (let i = 0; i < emptyCount; i++) {
      const row = i
      newSymbols.push(pickRefillSymbol(cfg, window, r, row, rng, isFreeGame, freeSpinSource, winningSymbolMap))
    }

    const nextReel = [...newSymbols, ...survivors].slice(-reel.length)

    for (let row = 0; row < reel.length; row++) {
      window[r][row] = nextReel[row]
    }

    topPreview[r] = newSymbols.map(s => ({ ...s }))

    for (let i = 0; i < newSymbols.length; i++) {
      refillSymbols.push({
        reel: r,
        row: i,
        sourceRow: i - newSymbols.length,
        symbol: { ...newSymbols[i] },
      })
    }
  }

  return { refillSymbols, topPreview }
}

function pickRefillSymbol(
  cfg: EngineConfig,
  window: Symbol[][],
  reel: number,
  row: number,
  rng: () => number,
  isFreeGame: boolean,
  freeSpinSource: 'natural' | 'buy',
  winningSymbolMap: Map<SymbolKind, number>,
): Symbol {
  let symbol: Symbol
  let attempts = 0

  do {
    symbol = pickWeightedSymbol(cfg, GAME_CONFIG.cascadeFillPool, winningSymbolMap, rng)
    attempts++

    const sameColumnCount = window.filter(col => col[row]?.kind === symbol.kind).length
    const columnCap = cfg.caps.column[symbol.kind]
    if (columnCap !== undefined && sameColumnCount >= columnCap && cfg.mode === 'NORMAL') {
      continue
    }

    const sameKindCount = window[reel].filter(s => s.kind === symbol.kind).length
    const rowCap = cfg.caps.reel[symbol.kind]
    if (rowCap !== undefined && sameKindCount >= rowCap && cfg.mode === 'NORMAL') {
      continue
    }
    if (symbol.kind !== 'WILD' && sameKindCount < cfg.cascades.maxSameSymbolPerReel) break
  } while (attempts < 20)

  const goldAllowed = reel !== 0 && reel !== window.length - 1
  const baseFreeRefillChance =
    freeSpinSource === 'natural'
      ? cfg.gold.freeRefillChance * cfg.gold.naturalFreeRefillBoost
      : cfg.gold.freeRefillChance
  const goldChance = isFreeGame || cfg.mode === 'HAPPY_HOUR' ? baseFreeRefillChance : cfg.gold.refillChance

  if (goldAllowed && isGoldEligible(symbol.kind, cfg.mode === 'HAPPY_HOUR') && rng() < goldChance) {
    symbol.isGold = true
    symbol.goldTTL = cfg.gold.ttl
    symbol.goldMultiplier = pickGoldMultiplier(cfg, rng)
  }

  return symbol
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
