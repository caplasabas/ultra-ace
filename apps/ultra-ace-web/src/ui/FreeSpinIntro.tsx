interface Props {
  spins: number
  countdown: number
}

export function FreeSpinIntro({ spins, countdown }: Props) {
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
          <div className="scatter-start-countdown">Press SPIN or auto start in {countdown}s</div>
        </div>
      </div>
    </div>
  )
}
