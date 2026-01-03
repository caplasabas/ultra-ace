export function formatPeso(
  amount: number | string,
  withSymbol = true,
  withDecimal = true,
  decimalCount = 3,
): string {
  const num = Number(amount)
  if (isNaN(num)) return withSymbol ? '₱0' : '0'

  let formatted = num.toFixed(withDecimal ? decimalCount : 0).replace(/\d(?=(\d{3})+\.)/g, '$&,')

  if (formatted.endsWith('.00')) {
    formatted = formatted.slice(0, -3)
  }

  return `${withSymbol ? '₱' : ''}${formatted}`
}
