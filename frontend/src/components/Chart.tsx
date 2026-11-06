import type { Insights } from '../api'

/** Small dependency-free SVG bar/line chart driven by the insight's chart suggestion. */
export function Chart({ spec, rows }: { spec: Insights['chart']; rows: Record<string, string>[] }) {
  if (spec.type === 'none' || !rows.length || !(spec.x in rows[0]) || !(spec.y in rows[0])) return null
  const data = rows
    .slice(0, 30)
    .map((r) => ({ label: shortLabel(r[spec.x]), value: Number(r[spec.y]) }))
    .filter((d) => Number.isFinite(d.value))
  if (!data.length) return null

  const W = 640, H = 260, padL = 56, padB = 64, padT = 12
  const max = Math.max(...data.map((d) => d.value), 0)
  const min = Math.min(...data.map((d) => d.value), 0)
  const span = max - min || 1
  const step = (W - padL) / data.length
  const y = (v: number) => padT + (H - padB - padT) * (1 - (v - min) / span)

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${spec.y} by ${spec.x}`}>
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} className="axis" />
        <text x={padL - 6} y={y(max) + 4} className="tick" textAnchor="end">{fmt(max)}</text>
        {min < 0 && <text x={padL - 6} y={y(min) + 4} className="tick" textAnchor="end">{fmt(min)}</text>}
        {spec.type === 'bar'
          ? data.map((d, i) => (
              <rect key={i} x={padL + i * step + step * 0.15} width={step * 0.7}
                y={Math.min(y(d.value), y(0))} height={Math.abs(y(d.value) - y(0))} className="bar">
                <title>{`${d.label}: ${d.value}`}</title>
              </rect>
            ))
          : <polyline className="line" fill="none"
              points={data.map((d, i) => `${padL + i * step + step / 2},${y(d.value)}`).join(' ')} />}
        {data.map((d, i) => (
          <text key={i} className="tick" textAnchor="end"
            transform={`translate(${padL + i * step + step / 2},${H - padB + 14}) rotate(-35)`}>{d.label}</text>
        ))}
      </svg>
      <figcaption className="muted">{spec.y} by {spec.x}</figcaption>
    </figure>
  )
}

const shortLabel = (s: string) => {
  const local = s.includes('/') || s.includes('#') ? s.split(/[/#]/).pop() ?? s : s
  return local.length > 16 ? local.slice(0, 15) + '…' : local
}
const fmt = (n: number) => Intl.NumberFormat(undefined, { notation: 'compact' }).format(n)
