// src/math/multiplier.ts
export function getCascadeMultiplier(index: number): number {
  if (index < 2) return 1
  if (index === 2) return 2
  if (index === 3) return 3
  return 5
}
