/**
 * ROIChart.jsx — pure SVG implementation
 *
 * Replaced Chart.js with a hand-rolled SVG chart.
 * Reasons:
 *   1. Chart.js plugin used scales.x.getPixelForIndex() which does not exist
 *      in Chart.js v3/v4, causing an uncaught TypeError and white-page crash.
 *   2. The canvas "already in use" error happened because Chart.js does not
 *      automatically destroy instances when the parent component unmounts and
 *      remounts (e.g. Layer 1 → Layer 2 → Layer 1 navigation).
 *   3. SVG has zero lifecycle concerns — it is just DOM, renders on every call,
 *      and disappears cleanly with its parent. No destroy(), no registry, no key tricks.
 *
 * Chart logic:
 *   RED  line = cumulative utility bills WITHOUT the system (grows linearly year-over-year)
 *   GREEN line = total cost WITH the system = CAPEX + (cumulative_baseline - cumulative_savings)
 *
 *   Year 0 is plotted explicitly: green=CAPEX, red=0.
 *   This makes the green line visually start FROM the full CAPEX value, which matches
 *   the financial report. The lines converge at break-even and diverge after.
 *
 * Props:
 *   financials — from finalDesignSnapshot.financials (must have yearly_data)
 *   capex      — from finalDesignSnapshot.capexBreakdown.total
 */

import { useMemo } from 'react'

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(v) {
  if (v == null || isNaN(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000)     return `${(v / 1_000).toFixed(0)}K`
  return `${Math.round(v).toLocaleString()}`
}

function fmtFull(v) {
  if (v == null || isNaN(v)) return '—'
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M SAR`
  if (abs >= 1_000)     return `${(v / 1_000).toFixed(0)}K SAR`
  return `${Math.round(v).toLocaleString()} SAR`
}

// ── SVG Line Chart ────────────────────────────────────────────────────────────
function SvgLineChart({ points, width = 600, height = 200, padL = 72, padR = 20, padT = 30, padB = 36 }) {
  // points: [{ x: number, redY: number, greenY: number }]
  // x is the year (0–10), redY and greenY are the SAR values

  const allY  = points.flatMap(p => [p.redY, p.greenY])
  const minY  = Math.min(...allY)
  const maxY  = Math.max(...allY)
  const rangeY = maxY - minY || 1

  const chartW = width - padL - padR
  const chartH = height - padT - padB

  const xScale = x => padL + (x / (points.length - 1)) * chartW
  const yScale = y => padT + chartH - ((y - minY) / rangeY) * chartH

  // Build polyline point strings
  const redPts   = points.map(p => `${xScale(p.x).toFixed(1)},${yScale(p.redY).toFixed(1)}`).join(' ')
  const greenPts = points.map(p => `${xScale(p.x).toFixed(1)},${yScale(p.greenY).toFixed(1)}`).join(' ')

  // Y axis ticks (5 ticks)
  const nTicks = 5
  const yTicks = Array.from({ length: nTicks }, (_, i) => {
    const val = minY + (rangeY / (nTicks - 1)) * i
    return { val, y: yScale(val) }
  })

  // X axis labels (Yr 0 … Yr 10)
  const xLabels = points.map((p, i) => ({ label: i === 0 ? 'Yr 0' : `Yr ${p.x}`, x: xScale(p.x) }))

  // Find break-even index (first point where green <= red)
  const beyIdx = points.findIndex(p => p.greenY <= p.redY)

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
    >
      {/* Grid lines */}
      {yTicks.map((t, i) => (
        <line key={i} x1={padL} x2={width - padR} y1={t.y} y2={t.y}
          stroke={i === 0 ? '#D1D5DB' : '#E5E7EB'} strokeWidth={0.5} />
      ))}

      {/* Fill: red area */}
      <polygon
        points={[
          `${padL},${padT + chartH}`,
          ...points.map(p => `${xScale(p.x).toFixed(1)},${yScale(p.redY).toFixed(1)}`),
          `${width - padR},${padT + chartH}`,
        ].join(' ')}
        fill="rgba(162,45,45,0.06)"
      />

      {/* Fill: green area */}
      <polygon
        points={[
          `${padL},${padT + chartH}`,
          ...points.map(p => `${xScale(p.x).toFixed(1)},${yScale(p.greenY).toFixed(1)}`),
          `${width - padR},${padT + chartH}`,
        ].join(' ')}
        fill="rgba(29,158,117,0.08)"
      />

      {/* Break-even vertical line */}
      {beyIdx > 0 && (() => {
        const bx = xScale(points[beyIdx].x)
        return (
          <>
            <line x1={bx} x2={bx} y1={padT} y2={padT + chartH}
              stroke="#1D9E75" strokeWidth={1.5} strokeDasharray="5,4" />
            <text x={bx} y={padT - 6} textAnchor="middle"
              style={{ fontSize: 9, fontWeight: 700, fill: '#1D9E75', fontFamily: '-apple-system, sans-serif' }}>
              Break-even Yr {points[beyIdx].x}
            </text>
          </>
        )
      })()}

      {/* Red line (dashed) */}
      <polyline points={redPts} fill="none" stroke="#A32D2D" strokeWidth={2}
        strokeDasharray="6,3" />

      {/* Green line (solid) */}
      <polyline points={greenPts} fill="none" stroke="#1D9E75" strokeWidth={2} />

      {/* Data points */}
      {points.map((p, i) => {
        const cx = xScale(p.x)
        const isPostBE = beyIdx > 0 && i >= beyIdx
        return (
          <g key={i}>
            <circle cx={cx} cy={yScale(p.redY)} r={3} fill="#A32D2D" />
            <circle cx={cx} cy={yScale(p.greenY)} r={3}
              fill={isPostBE ? '#1D9E75' : '#BA7517'} />
          </g>
        )
      })}

      {/* Y axis ticks + labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL - 4} x2={padL} y1={t.y} y2={t.y} stroke="#9CA3AF" strokeWidth={0.5} />
          <text x={padL - 6} y={t.y + 4} textAnchor="end"
            style={{ fontSize: 9, fill: '#9CA3AF', fontFamily: '-apple-system, sans-serif' }}>
            {fmt(t.val)}
          </text>
        </g>
      ))}

      {/* X axis labels — show every other to avoid crowding */}
      {xLabels.map((l, i) => (
        (i % 2 === 0) && (
          <text key={i} x={l.x} y={padT + chartH + 16} textAnchor="middle"
            style={{ fontSize: 9, fill: '#9CA3AF', fontFamily: '-apple-system, sans-serif' }}>
            {l.label}
          </text>
        )
      ))}

      {/* Y axis label */}
      <text x={14} y={padT + chartH / 2} textAnchor="middle"
        transform={`rotate(-90, 14, ${padT + chartH / 2})`}
        style={{ fontSize: 9, fill: '#9CA3AF', fontFamily: '-apple-system, sans-serif' }}>
        SAR
      </text>
    </svg>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ROIChart({ financials, capex: capexProp }) {
  const yearlyData = financials?.yearly_data || []
  const bey        = financials?.break_even_year || null

  const capex = (capexProp != null && !isNaN(Number(capexProp)) && Number(capexProp) > 0)
    ? Number(capexProp)
    : Number(financials?.capex_total_sar ?? 0)

  // Build chart points including Year 0 so green starts exactly at CAPEX
  const { points, milestones } = useMemo(() => {
    if (!yearlyData.length || !capex) {
      return { points: [], milestones: [] }
    }

    // Year 0: before any bills or savings
    const pts = [{ x: 0, redY: 0, greenY: capex }]

    for (const d of yearlyData) {
      const cumulativeBaseline = Number(d.baseline_cost_sar) || 0
      const cumulativeSavings  = Number(d.cumulative_savings_sar) || 0
      pts.push({
        x:      d.year,
        redY:   cumulativeBaseline,
        greenY: capex + cumulativeBaseline - cumulativeSavings,
      })
    }

    // Milestone summary cards (Yr 1, 5, 10)
    const ms = [1, 5, 10].map(yr => {
      const d  = yearlyData.find(x => x.year === yr)
      const pt = pts.find(p => p.x === yr)
      if (!d || !pt) return null
      const netAdvantage = pt.redY - pt.greenY
      return { yr, netAdvantage, saving: Number(d.cumulative_savings_sar) }
    }).filter(Boolean)

    return { points: pts, milestones: ms }
  }, [yearlyData, capex])

  // Empty state
  if (!yearlyData.length || !capex) {
    return (
      <div style={{
        height: 260, display: 'flex', alignItems: 'center',
        justifyContent: 'center', color: '#9CA3AF', fontSize: 13,
      }}>
        Generate your final design to see the financial projection.
      </div>
    )
  }

  return (
    <>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginBottom: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={20} height={10}>
            <line x1={0} y1={5} x2={20} y2={5} stroke="#A32D2D" strokeWidth={2} strokeDasharray="5,3" />
          </svg>
          <span style={{ fontSize: 11, color: '#6B7280' }}>Without system (cumulative utility bills)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width={20} height={10}>
            <line x1={0} y1={5} x2={20} y2={5} stroke="#1D9E75" strokeWidth={2} />
          </svg>
          <span style={{ fontSize: 11, color: '#6B7280' }}>With system (CAPEX + remaining utility cost)</span>
        </div>
        {bey && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width={16} height={10}>
              <line x1={8} y1={0} x2={8} y2={10} stroke="#1D9E75" strokeWidth={1.5} strokeDasharray="4,3" />
            </svg>
            <span style={{ fontSize: 11, color: '#1D9E75', fontWeight: 600 }}>Break-even Year {bey}</span>
          </div>
        )}
      </div>

      {/* SVG Chart — pure DOM, no canvas lifecycle issues */}
      <div style={{ position: 'relative', width: '100%' }}>
        <SvgLineChart points={points} width={640} height={220} />
      </div>

      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 6 }}>
        <span style={{ color: '#BA7517', fontWeight: 600 }}>Amber dots:</span>&nbsp;
        system still more expensive overall (before break-even).&nbsp;
        <span style={{ color: '#1D9E75', fontWeight: 600 }}>Green dots:</span>&nbsp;
        system is cheaper overall (after break-even).
        &nbsp;Green line starts at full CAPEX (Year 0) and converges toward red at break-even.
      </div>

      {/* Milestone cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 12 }}>
        {milestones.map(({ yr, netAdvantage, saving }) => (
          <div key={yr} style={{
            background:   netAdvantage >= 0 ? '#E1F5EE' : '#FFF8F0',
            borderRadius: 8,
            padding:      '10px 12px',
            textAlign:    'center',
            border:       `0.5px solid ${netAdvantage >= 0 ? '#9FE1CB' : '#FCD34D'}`,
          }}>
            <div style={{ fontSize: 10, color: '#6B7280', marginBottom: 3 }}>
              Year {yr} — cumulative savings
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: netAdvantage >= 0 ? '#085041' : '#92400E' }}>
              {fmtFull(saving)}
            </div>
            <div style={{ fontSize: 10, marginTop: 3, color: netAdvantage >= 0 ? '#1D9E75' : '#B45309' }}>
              Net advantage: {netAdvantage >= 0 ? '+' : ''}{fmtFull(netAdvantage)}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}