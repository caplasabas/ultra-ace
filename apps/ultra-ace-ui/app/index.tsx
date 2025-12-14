import { View, StyleSheet, Dimensions } from 'react-native'
import { useSpin } from '@hooks/useSpin'
import { Reel } from '@ui/Reel'
import { SpinButton } from '@ui/SpinButton'
import { WinCounter } from '@ui/WinCounter'
import { DebugHUD } from '@ui/DebugHUD'
import { PaylinesOverlay } from '@ui/PaylinesOverlay'
import { ReelsViewport } from '@ui/ReelsViewport'
import { VISIBLE_ROWS } from '@constants/layout'

const DESIGN_WIDTH = 360

export default function SlotScreen() {
  const { spin, reels, win, debug, lineWins } = useSpin()
  const { width } = Dimensions.get('window')

  const maxAvailableWidth = width - 24
  const gameWidth = Math.min(maxAvailableWidth, DESIGN_WIDTH)

  const columnCount = reels.length
  const reelWidth = gameWidth / columnCount

  const winningPositions: Set<string> = new Set(
    lineWins.flatMap(lw => lw.positions.map(p => `${p.reel}-${p.row}`)),
  )

  return (
    <View style={styles.root}>
      <View style={styles.phoneFrame}>
        <View style={[styles.gameSurface, { width: gameWidth }]}>
          <DebugHUD info={debug} />

          <View style={styles.topSpacer} />

          <View style={styles.reelsSection}>
            <ReelsViewport reelWidth={reelWidth}>
              <View style={styles.reelsRow}>
                {reels.map((reel, i) => (
                  <Reel
                    key={i}
                    reel={reel}
                    reelIndex={i}
                    width={reelWidth}
                    winningPositions={winningPositions}
                    dim={lineWins.length > 0}
                  />
                ))}
              </View>

              <PaylinesOverlay lineWins={lineWins} reelWidth={reelWidth} rowCount={VISIBLE_ROWS} />
            </ReelsViewport>
          </View>

          <View style={styles.bottomPanel}>
            <WinCounter amount={win} />
            <SpinButton onPress={spin} />
          </View>
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

  phoneFrame: {
    flex: 0.97,
    backgroundColor: '#111',
    borderRadius: 32,
    padding: 10,
    borderWidth: 4,
    borderColor: '#333',
  },

  gameSurface: {
    flex: 1,
    backgroundColor: '#07141f',
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'space-between',
  },

  topSpacer: {
    height: 120,
  },

  reelsSection: {
    alignItems: 'center',
    marginBottom: 24,
  },

  reelsRow: {
    flexDirection: 'row',
  },

  bottomPanel: {
    paddingBottom: 48,
    alignItems: 'center',
    gap: 12,
  },
})
