type Props = {
  onClose?: () => void
}

export function OfflineModal({ onClose }: Props) {
  return (
    <div
      className="modal-backdrop"
      tabIndex={0}
      autoFocus
      onKeyDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      <div className="modal-card">
        <div className="modal-header">
          <h2 style={{ alignSelf: 'center', textAlign: 'center' }}>Internet Connection Required</h2>
        </div>

        <div className="modal-body">
          <div className="modal-row">
            <span>The game is currently offline.</span>
          </div>

          <div className="modal-warning" style={{ lineHeight: 1.55, fontSize: 15 }}>
            Existing animations or spins can finish, but new purchases, withdrawals, and balance
            actions are temporarily unavailable until the connection is restored.
          </div>

          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.88)',
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            Reconnect the cabinet to continue normal play.
          </div>
        </div>

        <div className="modal-actions">
          <button
            className="modal-cancel"
            onClick={() => {
              if (window.parent !== window) {
                window.parent.postMessage({ type: 'ULTRAACE_OPEN_SETTINGS' }, '*')
              }
              onClose?.()
            }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  )
}
