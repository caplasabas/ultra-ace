export interface DebugSpinInfo {
  seed: string
  reelStops: number[]
  bet: number
  win: number
}

interface Props {
  info?: DebugSpinInfo
}

export function DebugHud({ info }: Props) {
  return (
    <div style={styles.container}>
      <div style={styles.line}>Seed: {info?.seed}</div>
      <div style={styles.line}>ReelStops: [{info?.reelStops.join(', ')}]</div>
      <div style={styles.line}>Bet: {info?.bet}</div>
      <div style={styles.line}>Win: {info?.win.toFixed(2)}</div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    // position: 'absolute',
    // top: 12,
    // left: 12,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    fontFamily: 'monospace',
    zIndex: 1000,
    width: 'fit-content',
    margin: '0 auto',
  },
  line: {
    color: '#0f0',
    fontSize: 12,
    lineHeight: '16px',
  },
}
