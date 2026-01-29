import { formatPeso } from '@ultra-ace/engine'

type Props = {
  withdrawAmount: number
  isWithdrawing: boolean
  balance: number
  onAddAmount: () => void
  onMinusAmount: () => void
  onConfirm: () => void
  onCancel: () => void
}

export function WithdrawModal({
  withdrawAmount,
  isWithdrawing,
  balance,
  onAddAmount,
  onMinusAmount,
  onConfirm,
  onCancel,
}: Props) {
  const canAfford = balance >= withdrawAmount

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h2>Withdraw Balance</h2>

        <div className="modal-row">
          <span>Withdraw Amount</span>
          <div className="bet-adjust">
            <button disabled={isWithdrawing} onClick={onMinusAmount}>
              −
            </button>
            <span>{formatPeso(withdrawAmount)}</span>
            <button disabled={isWithdrawing} onClick={onAddAmount}>
              +
            </button>
          </div>
        </div>

        {!canAfford && <div className="modal-warning">Insufficient balance</div>}

        <div className="modal-actions">
          <button disabled={isWithdrawing} onClick={onCancel}>
            Cancel
          </button>
          <button disabled={!canAfford || isWithdrawing} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  )
}
