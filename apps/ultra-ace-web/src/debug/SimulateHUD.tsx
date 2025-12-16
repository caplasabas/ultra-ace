// import { useState } from 'react'
// import { spin, createRNG } from '@ultra-ace/engine'
//
// export function SimulateHUD() {
//   const [stats, setStats] = useState<any>(null)
//
//   function run() {
//     const rng = createRNG('test')
//     let bet = 0
//     let win = 0
//
//     for (let i = 0; i < 10000; i++) {
//       const o = spin(rng, { betPerSpin: 20, lines: 5 })
//       bet += o.bet
//       win += o.win
//     }
//
//     setStats({ rtp: (win / bet).toFixed(3) })
//   }
//
//   return (
//     <div className="hud">
//       <button onClick={run}>Simulate</button>
//       {stats && <pre>{JSON.stringify(stats, null, 2)}</pre>}
//     </div>
//   )
// }
