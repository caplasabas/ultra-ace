import { formatPeso } from '@ultra-ace/engine'

interface Props {
  title: string
  amount: number
  phase: 'highlight' | 'pop' | null
}

export function WinOverlay({ title, amount, phase }: Props) {
  if (!phase || amount <= 0) return null

  const text = formatPeso(amount, false, true, 2)

  return (
    <div className="win-overlay">
      <div className={`win-burst ${phase}`}>
        <div className="win-glow" />
        <div className="win-face">
          {title && title !== '' && (
            <div className={`win-title ${title.replace(/\s+/g, '-').toLowerCase()}`}>{title}</div>
          )}

          <div className="win-total">{text}</div>
        </div>
      </div>
    </div>
  )
}
