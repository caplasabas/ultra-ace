import { View, StyleSheet, Dimensions } from 'react-native'
import { useSpin } from '@hooks/useSpin'
import { Reel } from '@ui/Reel'
import { SpinButton } from '@ui/SpinButton'
import { WinCounter } from '@ui/WinCounter'
import { DebugHUD } from '@ui/DebugHUD'
import { PaylinesOverlay } from '@ui/PaylinesOverlay'
import { VISIBLE_ROWS } from '@constants/layout'
import { isMobile } from '@hooks/useLayoutType'

const DESIGN_WIDTH = 360

export default function SlotScreen() {
  const { spin, reels, win, debug, lineWins, winningPositions } = useSpin()
  const { width } = Dimensions.get('window')

  const maxAvailableWidth = width - 24
  const gameWidth = Math.min(maxAvailableWidth, DESIGN_WIDTH)

  const reelWidth = gameWidth / (reels.length ? reels.length : 5)

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
                reelWidth={reelWidth}
                winningPositions={winningPositions}
              />
            ))}
          </View>

          <PaylinesOverlay lineWins={lineWins} reelWidth={reelWidth} rowCount={VISIBLE_ROWS} />
        </View>

        <View style={styles.bottomPanel}>
          <WinCounter amount={win} />
          <SpinButton onPress={spin} />
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
    flex: isMobile ? 1 : 0.95,
    borderRadius: isMobile ? 0 : 10,
    backgroundColor: '#0f3e4b',
    // borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 5,
  },

  reelsSection: {
    alignItems: 'center',
    marginBottom: 24,
  },

  reelsRow: {
    width: '100%',
    flexDirection: 'row',
  },

  bottomPanel: {
    alignItems: 'center',
    gap: 12,
  },
})
