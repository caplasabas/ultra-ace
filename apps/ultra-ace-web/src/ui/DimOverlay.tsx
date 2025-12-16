// src/ui/DimOverlay.tsx
import './dim.css'

export function DimOverlay({ active }: { active: boolean }) {
  return <div className={`dim ${active ? 'active' : ''}`} aria-hidden />
}
