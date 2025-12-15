import { useRef, useState } from 'react'
import { executeSpin } from '@game/spinController'
import type { VisualSpinResult } from '@game/types'
import type { UISymbolInstance } from '@components/types'
import { useCascadeTimeline } from './useCascadeTimeline'

let uid = 0
const nextId = () => `sym-${uid++}`

export function useSpin() {
  const [result, setResult] = useState<VisualSpinResult | null>(null)

  /**
   * symbolGridRef
   * [reel][row] -> UISymbolInstance
   * PERSISTS across cascade phases
   */
  const symbolGridRef = useRef<UISymbolInstance[][]>([])

  function spin() {
    const res = executeSpin({ betPerSpin: 20, lines: 20 })
    setResult(res)

    const seedCascade = res.outcome.cascades?.[0]
    if (!seedCascade) {
      symbolGridRef.current = []
      return
    }

    // ✅ Seed ONCE from cascade[0].window
    symbolGridRef.current = seedCascade.window.map(col =>
      col.map(symbol => ({
        id: nextId(),
        kind: symbol.kind,
        isNew: false,
      })),
    )
  }

  const cascades = result?.outcome.cascades ?? []
  const { phase, activeCascade } = useCascadeTimeline(cascades)

  /**
   * COLLAPSE (NO GRAVITY)
   * Just mark EMPTY — nothing moves
   */
  if (activeCascade && phase === 'collapse') {
    activeCascade.removedPositions.forEach(({ reel, row }) => {
      const sym = symbolGridRef.current[reel]?.[row]
      if (sym) sym.kind = 'EMPTY'
    })
  }

  /**
   * REFILL
   * Dealer drops new cards INTO EMPTY slots
   */
  if (activeCascade && phase === 'refill') {
    symbolGridRef.current.forEach((col, reelIndex) => {
      col.forEach((sym, rowIndex) => {
        if (sym.kind === 'EMPTY') {
          const nextSymbol = activeCascade.window[reelIndex][rowIndex]

          symbolGridRef.current[reelIndex][rowIndex] = {
            id: nextId(),
            kind: nextSymbol.kind,
            isNew: true,
          }
        }
      })
    })
  }

  const reels =
    symbolGridRef.current.length > 0 ? symbolGridRef.current.map(col => ({ symbols: col })) : []

  return {
    spin,
    reels,
    phase,
    win: result?.outcome.win ?? 0,
    lineWins: activeCascade?.lineWins ?? [],
    winningPositions: new Set(
      activeCascade?.lineWins.flatMap(lw => lw.positions.map(p => `${p.reel}-${p.row}`)) ?? [],
    ),
    debug: result?.debug,
  }
}
