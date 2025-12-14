export interface RtpState {
  totalBet: number
  totalWin: number
}

export function applyRtpGovernor(
  rawWin: number,
  bet: number,
  state: RtpState,
  targetRtp: number
): number {

  // Update state as if raw win is paid
  const projectedRtp =
    (state.totalWin + rawWin) /
    (state.totalBet + bet)

  // If paying full win overshoots RTP, scale it
  if (projectedRtp > targetRtp) {
    const allowedWin =
      targetRtp * (state.totalBet + bet) - state.totalWin

    return Math.max(0, Math.floor(allowedWin))
  }

  return rawWin
}
