interface Props {
  spins: number
  countdown: number
  onStart: () => void
}

export function FreeSpinIntro({ spins, countdown, onStart }: Props) {
  return (
    <div className="scatter-intro">
      <div className="scatter-bg" />

      <div className="scatter-bg-glow" />
      <div className="scatter-content">
        <div className="scatter-title-container">
          <div className="scatter-title">CONGRATS</div>
          <div className="scatter-title">FREE GAME</div>
        </div>

        <div className="scatter-count">{spins} SPINS</div>

        <div className="scatter-multiplier">
          <div className="scatter-multiplier-title">ELIMINATION MULTIPLIER</div>

          <div className="scatter-multiplier-strip">x2 x4 x6 x10</div>
        </div>

        <div className="scatter-intro-actions">
          <button className="scatter-start-btn" onClick={onStart}>
            START FREE SPINS
          </button>
          <div className="scatter-start-countdown">Auto start in {countdown}s</div>
        </div>
      </div>
    </div>
  )
}
