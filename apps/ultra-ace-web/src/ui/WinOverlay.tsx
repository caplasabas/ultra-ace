import { formatPeso } from '@ultra-ace/engine'

interface Props {
  amount: number
  phase: 'highlight' | 'pop' | null
}

export function WinOverlay({ amount, phase }: Props) {
  if (!phase || amount <= 0) return null

  const text = formatPeso(amount, false, true, 3)

  return (
    <div className="win-overlay">
      <div className={`win-burst ${phase}`}>
        <div className="win-glow" />
        <div className="win-face">{text}</div>
      </div>
    </div>
  )
}
