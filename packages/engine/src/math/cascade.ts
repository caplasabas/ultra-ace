import { Symbol } from '../types/symbol'
import { CascadeStep } from '../types/cascade'
import { evaluateWindow } from './evaluator'
import { GAME_CONFIG } from '../config/game.config'

export function runCascades(initialWindow: Symbol[][], betPerLine: number, activeLines: number) {
  const window = cloneWindow(initialWindow)
  let totalWin = 0
  const cascades: CascadeStep[] = []

  const ladder = GAME_CONFIG.multiplierLadder

  cascades.push({
    index: 0,
    multiplier: ladder[0],
    lineWins: [],
    win: 0,
    removedPositions: [],
    window: cloneWindow(window),
  })

  for (let i = 1; i <= GAME_CONFIG.maxCascades; i++) {
    const multiplier = ladder[Math.min(i - 1, ladder.length - 1)]

    const lineWins = evaluateWindow(window, betPerLine * multiplier, activeLines)

    if (lineWins.length === 0) break

    const removed: { reel: number; row: number }[] = []

    for (const lw of lineWins) {
      for (const pos of lw.positions) {
        const symbol = window[pos.reel][pos.row]

        // Wild persists
        if (symbol.kind === 'WILD') continue

        window[pos.reel][pos.row] = { kind: 'EMPTY' }
        removed.push(pos)
      }
    }

    refill(window)

    const win = lineWins.reduce((s, l) => s + l.payout, 0)
    totalWin += win

    cascades.push({
      index: i,
      multiplier,
      lineWins,
      win,
      removedPositions: removed,
      window: cloneWindow(window),
    })
  }

  return { totalWin, cascades }
}

function refill(window: Symbol[][]) {
  for (let r = 0; r < window.length; r++) {
    for (let row = 0; row < window[r].length; row++) {
      if (window[r][row].kind === 'EMPTY') {
        window[r][row] =
          GAME_CONFIG.cascadeFillPool[
            Math.floor(Math.random() * GAME_CONFIG.cascadeFillPool.length)
          ]
      }
    }
  }
}

function cloneWindow(w: Symbol[][]): Symbol[][] {
  return w.map(col => col.map(s => ({ ...s })))
}
