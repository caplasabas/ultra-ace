import { View, StyleSheet, Dimensions } from 'react-native'
import { useSpin } from '@hooks/useSpin'
import { Reel } from '@ui/Reel'
import { SpinButton } from '@ui/SpinButton'
import { WinCounter } from '@ui/WinCounter'
import { PaylinesOverlay } from '@ui/PaylinesOverlay'
import { DimOverlay } from '@components/DimOverlay'
import { VISIBLE_ROWS } from '@constants/layout'
import { isMobile } from '@hooks/useLayoutType'
import { DebugHUD } from '@ui/DebugHUD'

const DESIGN_WIDTH = 360

export default function SlotScreen() {
  const { spin, reels, win, phase, debug, lineWins, winningPositions } = useSpin()
  const { width } = Dimensions.get('window')

  const gameWidth = Math.min(width - 24, DESIGN_WIDTH)
  const reelWidth = gameWidth / (reels.length || 5)

  const inputLocked = phase !== 'idle'

  const hasWins = phase === 'highlight' && lineWins.length > 0 && winningPositions.size > 0

  return (
    <View style={styles.root}>
      <View style={[styles.gameSurface, { width: isMobile ? '100%' : gameWidth }]}>
        <DebugHUD info={debug} />

        <View style={styles.reelsSection}>
          <View style={styles.reelsRow}>
            {reels.map((reel, i) => (
              <Reel
                key={i}
                reel={reel}
                reelIndex={i}
                winningPositions={winningPositions}
                phase={phase}
              />
            ))}
            <DimOverlay active={hasWins} />
          </View>

          <PaylinesOverlay lineWins={lineWins} reelWidth={reelWidth} rowCount={VISIBLE_ROWS} />
        </View>

        <View style={styles.bottomPanel}>
          <WinCounter amount={win} />
          <SpinButton onPress={spin} disabled={inputLocked} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gameSurface: {
    flex: 1,
    paddingVertical: 20,
    backgroundColor: '#0f3e4b',
    justifyContent: 'space-between',
  },
  reelsSection: {
    justifyContent: 'center',
  },
  reelsRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  bottomPanel: {
    alignItems: 'center',
    gap: 12,
  },
})
