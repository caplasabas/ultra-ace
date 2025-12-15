import { useState, useMemo } from 'react'
import { executeSpin } from '@game/spinController'
import type { VisualSpinResult } from '@game/types'
import { engineRowToUIRow } from '@utils/rowMapping'
import { VISIBLE_ROWS } from '@constants/layout'

export function useSpin() {
  const [result, setResult] = useState<VisualSpinResult | null>(null)
  const [isSpinning, setIsSpinning] = useState(false)

  function spin() {
    if (isSpinning) return
    setIsSpinning(true)

    const visualResult = executeSpin({
      betPerLine: 20,
      lines: 20,
    })

    setResult(visualResult)
    setIsSpinning(false)
  }

  const winningPositions = useMemo(() => {
    const set = new Set<string>()
    if (!result) return set

    for (const lw of result.outcome.lineWins) {
      for (const pos of lw.positions) {
        const uiRow = engineRowToUIRow(pos.row, VISIBLE_ROWS)
        set.add(`${pos.reel}-${uiRow}`)
      }
    }
    return set
  }, [result])

  return {
    spin,
    isSpinning,
    reels: result?.reels ?? [],
    win: result?.outcome.win ?? 0,
    bet: result?.outcome.bet ?? 0,
    lineWins: result?.outcome.lineWins ?? [],
    winningPositions,
    debug: result?.debug,
  }
}
