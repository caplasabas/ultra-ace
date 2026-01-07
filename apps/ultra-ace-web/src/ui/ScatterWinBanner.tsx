import { useEffect, useRef, useState } from 'react'
import { formatPeso } from '@ultra-ace/engine'

interface Props {
  amount: number
}

export function ScatterWinBanner({ amount }: Props) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef<number | null>(null)

  // @ts-ignore
  useEffect(() => {
    setTimeout(() => {
      const start = performance.now()
      const duration = 1600

      function tick(now: number) {
        const p = Math.min((now - start) / duration, 1)
        const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
        setDisplay(Math.floor(eased * amount))

        if (p < 1) {
          rafRef.current = requestAnimationFrame(tick)
        }
      }

      rafRef.current = requestAnimationFrame(tick)
      return () => rafRef.current && cancelAnimationFrame(rafRef.current)
    }, 300)
  }, [amount])

  return (
    <div className="scatter-intro scatter-win">
      <div className="scatter-win-bg" />
      <div className="scatter-win-glow" />

      <div className="scatter-win-content">
        <div className="scatter-win-title-container">
          <div className="scatter-win-title">CONGRATS!</div>
          <div className="scatter-win-title">YOU HAVE WON</div>
        </div>

        <div className="scatter-win-amount-wrap">
          <div className="scatter-win-amount-bg" />
          <div className="scatter-win-amount">{formatPeso(display)}</div>
        </div>
      </div>
    </div>
  )
}
