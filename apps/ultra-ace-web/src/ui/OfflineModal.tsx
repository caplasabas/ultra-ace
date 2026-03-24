type Props = {
  onClose?: () => void
}

export function OfflineModal({ onClose }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <div className="modal-header">
          <h2>Offline</h2>
        </div>
        <div className="modal-body">
          <div className="modal-row">
            <span>No internet connection detected.</span>
          </div>
          <div className="modal-warning">
            Spins can finish, but new purchases and balance actions are paused.
          </div>
        </div>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose ?? (() => {})}>
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
