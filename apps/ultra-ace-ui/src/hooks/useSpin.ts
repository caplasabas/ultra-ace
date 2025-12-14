import { useState } from 'react'
import { executeSpin } from '@game/spinController'

export function useSpin() {
  const [result, setResult] = useState<any>(null)
  const [isSpinning, setIsSpinning] = useState(false)
  const [showPaylines, setShowPaylines] = useState(false)

  function spin() {
    if (isSpinning) return

    setIsSpinning(true)
    setShowPaylines(false)

    const visualResult = executeSpin({
      betPerLine: 1,
      lines: 5,
    })

    setResult(visualResult)

    setTimeout(() => {
      setShowPaylines(true)
      setIsSpinning(false)
    }, 500)
  }

  return {
    spin,
    reels: result?.reels ?? [],
    win: result?.outcome?.win ?? 0,
    debug: result?.debug,
    lineWins: showPaylines ? (result?.outcome?.lineWins ?? []) : [],
    scatter: result?.outcome?.scatter,
  }
}
