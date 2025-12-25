interface Props {
  amount: number
  phase: 'highlight' | 'pop' | null
}

function formatWin(amount: number): string {
  if (Number.isInteger(amount)) {
    return amount.toFixed(1) // 4 → 4.0
  }

  return amount.toFixed(2).replace(/0$/, '').replace(/\.$/, '')
}

export function WinOverlay({ amount, phase }: Props) {
  if (!phase || amount <= 0) return null

  const text = formatWin(amount)

  return (
    <div className="win-overlay">
      <div className={`win-burst ${phase}`}>
        <div className="win-glow" />
        <div className="win-face">{text}</div>
      </div>
    </div>
  )
}
