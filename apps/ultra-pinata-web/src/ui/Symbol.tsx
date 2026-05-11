// import { motion } from 'framer-motion'
// import { CARD_HEIGHT, CARD_GAP } from '../styles/constants'
//
// interface Props {
//   row: number
//   isNew: boolean
//   isWinning: boolean
//   kind: string
//   phase: string
// }
//
// export function Symbol({ row, isNew, isWinning, phase, kind }: Props) {
//   const y = row * (CARD_HEIGHT + CARD_GAP)
//   const spawnY = -CARD_HEIGHT * 5
//
//   return (
//     <motion.div
//       initial={isNew ? { y: spawnY } : false}
//       animate={{
//         y,
//         scale:
//           phase === 'highlight' && isWinning
//             ? [1, 1.4, 1.3]
//             : phase === 'pop' && isWinning
//               ? [1.3, 0.8, 0]
//               : 1,
//         opacity: phase === 'pop' && isWinning ? 0 : 1,
//       }}
//       transition={{
//         y: { duration: isNew ? 0.6 : 0 },
//         scale: { duration: 0.35 },
//         opacity: { duration: 0.25 },
//       }}
//       style={{
//         position: 'absolute',
//         width: '100%',
//         height: CARD_HEIGHT,
//         zIndex: isWinning ? 10 : 1,
//       }}
//       className={`symbol symbol-${kind}`}
//     />
//   )
// }
