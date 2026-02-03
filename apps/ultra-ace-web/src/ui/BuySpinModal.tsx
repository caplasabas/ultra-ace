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
        <div className="modal-header">
          <h2>Buy Free Spins</h2>
        </div>

        <div className="modal-body">
          <div className="modal-row">
            <span>Bet Amount</span>
            <div className="bet-adjust">
              <button onClick={onMinusBet} className="modal-toggle">
                −
              </button>
              <strong>{formatPeso(bet)}</strong>
              <button onClick={onAddBet} className="modal-toggle">
                +
              </button>
            </div>
          </div>

          <div className="modal-row">
            <span>Cost</span>
            <strong>{formatPeso(cost)}</strong>
          </div>

          {!canAfford && <div className="modal-warning">Insufficient balance</div>}
        </div>

        <div className="modal-actions">
          <button onClick={onCancel} className="modal-cancel">
            Cancel
          </button>
          <button disabled={!canAfford} onClick={onConfirm} className="modal-confirm">
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
