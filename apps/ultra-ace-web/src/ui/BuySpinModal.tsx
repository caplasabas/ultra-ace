import { formatPeso } from '@ultra-ace/engine'

type Props = {
  bet: number
  balance: number
  onAddBet: () => void
  onMinusBet: () => void
  onConfirm: () => void
  onCancel: () => void
}

export function BuySpinModal({ bet, balance, onAddBet, onMinusBet, onConfirm, onCancel }: Props) {
  const cost = bet * 50
  const canAfford = balance >= cost

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2>BUY FREE SPINS</h2>

        <div className="modal-row">
          <span>Bet Amount</span>
          <div className="bet-adjust">
            <button onClick={onMinusBet}>−</button>
            <span>{formatPeso(bet)}</span>
            <button onClick={onAddBet}>+</button>
          </div>
        </div>

        <div className="modal-row">
          <span>Cost</span>
          <strong>{formatPeso(cost)}</strong>
        </div>

        {!canAfford && <div className="modal-warning">Insufficient balance</div>}

        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button disabled={!canAfford} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
