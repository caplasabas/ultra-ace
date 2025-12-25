export function getCascadeMultiplier(
  cascadeIndex: number,
  isFreeGame: boolean,
  baseLadder: number[],
  freeLadder: number[],
) {
  const ladder = isFreeGame ? freeLadder : baseLadder

  return ladder[Math.min(cascadeIndex - 1, ladder.length - 1)]
}
