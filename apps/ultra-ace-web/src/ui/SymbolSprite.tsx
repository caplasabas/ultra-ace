interface Props {
  kind: string
}

export function SymbolSprite({ kind }: Props) {
  return <img src={`/symbols/${kind}.png`} className="symbol-img" draggable={false} />
}
