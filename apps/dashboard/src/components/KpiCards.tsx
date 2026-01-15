type Props = {
  gross: number
  payouts: number
  net: number
  rtp: number
}

export function KpiCards({ gross, payouts, net, rtp }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Kpi label="Gross" value={`₱${gross.toLocaleString()}`} />
      <Kpi label="Payouts" value={`₱${payouts.toLocaleString()}`} />
      <Kpi label="Net" value={`₱${net.toLocaleString()}`} />
      <Kpi label="RTP" value={`${rtp.toFixed(2)}%`} />
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-900 p-4 border border-slate-800">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  )
}
