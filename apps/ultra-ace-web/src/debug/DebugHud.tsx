import { CSSProperties } from 'react'
import { formatPeso } from '@ultra-ace/engine'

export interface DebugSpinInfo {
  seed: string
  bet: number
  win: number
  cascadeWins: number[]
}

interface Props {
  info?: DebugSpinInfo
}

export function DebugHud({ info }: Props) {
  const cascadeWinArray =
    info?.cascadeWins && info.cascadeWins.length > 1
      ? info.cascadeWins
          .slice(1) // ⬅ start from cascade #2
          .map(w => formatPeso(w))
          .join(', ')
      : '—'

  return (
    <div style={styles.container}>
      {/*<div style={styles.line}>Seed: {info?.seed}</div>*/}
      <div style={styles.line}>Wins: [{cascadeWinArray}]</div>
      <div style={styles.line}>Bet: {info?.bet}</div>

      <div style={styles.line}>Total Win: {formatPeso(info?.win ?? 0)}</div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    padding: 8,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 6,
    fontFamily: 'monospace',
    zIndex: 1000,
    width: 'fit-content',
    // margin: '0 auto',
  },
  line: {
    color: '#0f0',
    fontSize: 12,
    lineHeight: '16px',
  },
  subLine: {
    color: '#9f9',
    fontSize: 11,
    paddingLeft: 10,
    lineHeight: '14px',
  },
}
