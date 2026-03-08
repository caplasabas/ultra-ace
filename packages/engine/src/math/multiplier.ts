export function getCascadeMultiplier(
  cascadeIndex: number,
  isFreeGame: boolean,
  baseLadder: number[],
  freeLadder: number[],
) {
  const ladder = isFreeGame ? freeLadder : baseLadder

  const index = Math.max(0, cascadeIndex - 1)
  if (index < ladder.length) return ladder[index]

  // Continue scaling beyond ladder length using the last observed increment.
  const last = ladder[ladder.length - 1] ?? 1
  const prev = ladder[ladder.length - 2] ?? last - 1
  const step = Math.max(1, last - prev)
  return last + (index - (ladder.length - 1)) * step
}
