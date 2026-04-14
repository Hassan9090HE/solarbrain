/**
 * DesignView.jsx — Layer 1 (clean rewrite)
 *
 * Two-stage flow:
 *   Stage A — Generate Base Design: sizes the system, shows component option cards
 *   Stage B — Generate Final Design: freezes the selected combination into a snapshot,
 *             renders the final diagram, financials (with demand savings for facility),
 *             and the 10-year chart
 *
 * Chart fix (permanent):
 *   Stage B reads exclusively from `finalDesignSnapshot` in the store.
 *   The snapshot is a plain object set only on "Generate Final Design" click.
 *   It is never recomputed reactively, never goes null after first generation,
 *   and survives Layer 1 → Layer 2 → Layer 1 navigation completely.
 *   There is no reactive dependency chain that can silently null it out.
 *
 * Demand savings:
 *   Integrated into the financial model for FACILITY only.
 *   Adds to every year's savings, affects break-even and net benefit.
 *   Not applied to farm or residential.
 */

import { useState, useMemo } from 'react'
import { useApp }        from '../store'
import { submitDesign }  from '../api'
import ROIChart          from '../components/ROIChart'
import SystemDiagram     from '../components/SystemDiagram'

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  dark:    '#0F1923',
  green:   '#1D9E75',
  amber:   '#BA7517',
  blue:    '#185FA5',
  red:     '#A32D2D',
  gray:    '#6B7280',
  lightBg: '#F4F6F8',
  border:  '#D1D5DB',
  white:   '#ffffff',
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page:        { minHeight: '100vh', background: C.lightBg, padding: '24px 16px' },
  container:   { maxWidth: 980, margin: '0 auto' },
  header:      { background: C.dark, borderRadius: 12, padding: '20px 24px', marginBottom: 20, color: C.white },
  headerTitle: { fontSize: 22, fontWeight: 600, margin: 0 },
  headerSub:   { fontSize: 13, color: '#9FE1CB', marginTop: 4 },
  card:        { background: C.white, borderRadius: 12, border: `0.5px solid ${C.border}`, padding: '20px 24px', marginBottom: 16 },
  cardTitle:   { fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 16, paddingBottom: 10, borderBottom: '0.5px solid #E5E7EB' },
  sectionLbl:  { fontSize: 11, fontWeight: 600, color: C.gray, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 },
  grid2:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  grid3:       { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
  formGroup:   { display: 'flex', flexDirection: 'column', gap: 5 },
  label:       { fontSize: 12, fontWeight: 500, color: C.gray },
  input:       { padding: '8px 12px', borderRadius: 8, border: `0.5px solid ${C.border}`, fontSize: 13, outline: 'none', background: C.white, color: '#111827' },
  select:      { padding: '8px 12px', borderRadius: 8, border: `0.5px solid ${C.border}`, fontSize: 13, background: C.white, color: '#111827' },
  btnGreen:    { background: C.green,  color: C.white,   border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnAmber:    { background: C.amber,  color: C.white,   border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  btnDisabled: { background: '#9CA3AF',color: C.white,   border: 'none', borderRadius: 8, padding: '12px 28px', fontSize: 14, cursor: 'not-allowed' },
  btnSim:      { background: C.dark,   color: '#9FE1CB', border: 'none', borderRadius: 8, padding: '12px 32px', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
  error:       { background: '#FFF0F0', border: '0.5px solid #FECACA', borderRadius: 8, padding: '12px 16px', color: C.red, fontSize: 13, marginBottom: 16 },
  loading:     { textAlign: 'center', padding: '40px', color: C.gray, fontSize: 14 },
  infoBanner:  { background: '#F0FBF7', border: '0.5px solid #9FE1CB', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#085041', marginBottom: 12, lineHeight: 1.6 },
  tag:         { fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 6, background: '#E1F5EE', color: '#085041', display: 'inline-block' },
  badge:       { fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 10, display: 'inline-block', marginBottom: 8 },
  metricGrid:  { display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 },
  metric:      { background: C.lightBg, borderRadius: 8, padding: '12px 14px' },
  metricLbl:   { fontSize: 11, color: C.gray, marginBottom: 4 },
  metricVal:   { fontSize: 20, fontWeight: 600, color: '#111827' },
  metricUnit:  { fontSize: 11, color: C.gray, marginTop: 2 },
  finRow:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid #E5E7EB', fontSize: 13 },
  finRowLast:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', fontSize: 14, fontWeight: 600 },
  breakeven:   { background: '#E1F5EE', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#085041', fontWeight: 500, marginTop: 12 },
  detailsBtn:  { background: 'transparent', border: `0.5px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', fontSize: 11, color: C.gray, cursor: 'pointer', marginTop: 8, display: 'flex', alignItems: 'center', gap: 5 },
  detailsPanel:{ background: '#F9FAFB', border: '0.5px solid #E5E7EB', borderRadius: 8, padding: '14px 16px', marginTop: 10, fontSize: 12 },
  detailRow:   { display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid #F3F4F6', color: '#374151', lineHeight: 1.4 },
  co2Card:     { background: '#F0FBF7', border: '0.5px solid #9FE1CB', borderRadius: 8, padding: '12px 14px', marginTop: 12 },
  demandCard:  { background: '#FFF8F0', border: '0.5px solid #FCD34D', borderRadius: 8, padding: '12px 14px', marginTop: 12 },
}

const LABEL_STYLES = {
  'Best value':       { background: '#E1F5EE', color: '#085041' },
  'Best performance': { background: '#FAEEDA', color: '#633806' },
  'Budget option':    { background: '#F3F0FF', color: '#3C3489' },
}

// ── Financial model (pure JS — mirrors Python sizing_engine) ──────────────────
// For FACILITY: annualDemandSaving is added to each year's savings.
// For FARM / RESIDENTIAL: demandSavingPerYear = 0.
function computeFinancials({
  arrayKwp, ghi, performanceRatio, tariff,
  gridScenario, capexTotal, monthlyBill,
  hasGenerator = false, generatorKva = 0,
  annualDemandSaving = 0,   // FACILITY only — 0 for others
  years = 10,
}) {
  if (!arrayKwp || !ghi || !capexTotal) return null

  const degradation = 0.99
  let cumSavings    = 0
  let breakEvenYear = null
  const yearlyData  = []

  for (let yr = 1; yr <= years; yr++) {
    const degFactor     = Math.pow(degradation, yr)
    const productionKwh = arrayKwp * ghi * 365 * performanceRatio * degFactor
    const gridSavings   = productionKwh * (tariff?.rate_sar_kwh || 0.22)

    let exportRevenue = 0
    if (gridScenario === 'on_grid') {
      exportRevenue = productionKwh * 0.20 * (tariff?.export_rate_sar_kwh || 0.12)
    }

    let dieselSavings = 0
    if (hasGenerator && gridScenario === 'off_grid') {
      dieselSavings = generatorKva * 0.8 * 365 * 6 * degFactor * 0.25 * 0.75
    }

    // Demand saving does NOT degrade with panels — it's a tariff structure benefit
    const totalSavingsYr = +(gridSavings + exportRevenue + dieselSavings + annualDemandSaving).toFixed(2)
    cumSavings += totalSavingsYr

    yearlyData.push({
      year:                   yr,
      production_kwh:         Math.round(productionKwh),
      grid_savings_sar:       +gridSavings.toFixed(2),
      export_revenue_sar:     +exportRevenue.toFixed(2),
      diesel_savings_sar:     +dieselSavings.toFixed(2),
      demand_savings_sar:     +annualDemandSaving.toFixed(2),
      total_savings_sar:      totalSavingsYr,
      cumulative_savings_sar: +cumSavings.toFixed(2),
      baseline_cost_sar:      +((monthlyBill || 0) * 12 * yr).toFixed(2),
    })

    if (breakEvenYear === null && cumSavings >= capexTotal) {
      breakEvenYear = yr
    }
  }

  const get = yr => yearlyData.find(d => d.year === yr)

  return {
    capex_total_sar:              +capexTotal.toFixed(2),
    monthly_savings_sar:          +(yearlyData[0].total_savings_sar / 12).toFixed(2),
    year_1_savings_sar:           get(1)?.cumulative_savings_sar || 0,
    year_5_savings_sar:           get(5)?.cumulative_savings_sar || 0,
    year_10_savings_sar:          get(10)?.cumulative_savings_sar || 0,
    break_even_year:              breakEvenYear,
    baseline_10yr_cost_sar:       +((monthlyBill || 0) * 12 * 10).toFixed(2),
    net_10yr_benefit_sar:         +((get(10)?.cumulative_savings_sar || 0) - capexTotal).toFixed(2),
    yearly_data:                  yearlyData,
    annual_production_yr1_kwh:    yearlyData[0]?.production_kwh || 0,
    annual_grid_savings_yr1_sar:  yearlyData[0]?.grid_savings_sar || 0,
    annual_export_revenue_yr1_sar:yearlyData[0]?.export_revenue_sar || 0,
    annual_demand_savings_yr1_sar:annualDemandSaving,
  }
}

// ── Demand savings — FACILITY ONLY ────────────────────────────────────────────
function computeDemandSavings(peakLoadKw) {
  if (!peakLoadKw || peakLoadKw <= 0) return null
  const peakReductionKw        = peakLoadKw * 0.20
  const demandChargeSarKwMonth = 18
  const monthlyDemandSaving    = +(peakReductionKw * demandChargeSarKwMonth).toFixed(0)
  const annualDemandSaving     = +(monthlyDemandSaving * 12).toFixed(0)
  return {
    peak_reduction_kw:          +peakReductionKw.toFixed(1),
    monthly_demand_saving_sar:  monthlyDemandSaving,
    annual_demand_saving_sar:   annualDemandSaving,
    assumption:                 `~20% peak demand reduction × ${demandChargeSarKwMonth} SAR/kW/month (conservative SA commercial estimate)`,
  }
}

// ── CO2 ───────────────────────────────────────────────────────────────────────
function computeCO2(annualKwh) {
  if (!annualKwh) return null
  const co2Kg = annualKwh * 0.72
  return {
    yr1_co2_tonnes:   +(co2Kg / 1000).toFixed(1),
    yr10_co2_tonnes:  +(co2Kg * 9.56 / 1000).toFixed(1),
    trees_equivalent: Math.round(co2Kg / 21.7),
  }
}

// ── Build the frozen snapshot on Generate Final ───────────────────────────────
function buildSnapshot({ systemDesign, panel, inverter, battery }) {
  const base      = systemDesign.capex_breakdown
  const panelCost = panel?.panels_cost_sar    ?? base.panels_sar
  const invCost   = inverter?.inverter_cost_sar ?? base.inverter_sar
  const batCost   = battery?.battery_cost_sar   ?? base.battery_sar
  const total     = panelCost + invCost + batCost + base.protection_sar + base.bos_sar

  const prof     = systemDesign.profile
  const req      = systemDesign.requirements
  const tariff   = systemDesign.simulation_config?.tariff
  const userType = prof.user_type
  const arrayKwp = panel?.actual_kwp ?? req.pv_kwp_required

  // Demand savings for FACILITY only
  const demandSavings = userType === 'facility'
    ? computeDemandSavings(prof.peak_load_kw)
    : null

  const annualDemandSaving = demandSavings?.annual_demand_saving_sar ?? 0

  const financials = computeFinancials({
    arrayKwp,
    ghi:              prof.ghi,
    performanceRatio: req.performance_ratio || 0.655,
    tariff,
    gridScenario:     prof.grid_scenario,
    capexTotal:       total,
    monthlyBill:      prof.monthly_bill_sar,
    hasGenerator:     systemDesign.generator != null,
    generatorKva:     systemDesign.generator?.kva ?? 0,
    annualDemandSaving,
    years:            10,
  })

  const co2 = computeCO2(financials?.annual_production_yr1_kwh)

  return {
    financials,
    capexBreakdown: { panelCost, invCost, batCost, protectionSar: base.protection_sar, bosSar: base.bos_sar, total },
    panel,
    inverter,
    battery,
    systemProfile: prof,
    requirements: req,
    demandSavings,
    co2,
    userType,
    tariff,
  }
}

// ── Payload builder ───────────────────────────────────────────────────────────
function buildPayload(form) {
  const p = {
    user_type:         form.user_type,
    region:            form.region,
    grid_scenario:     'on_grid',
    monthly_bill_sar:  Number(form.monthly_bill_sar),
    operating_hours:   Number(form.operating_hours) || 10,
    critical_load_pct: Number(form.critical_load_pct) || 30,
  }
  if (form.peak_load_kw)     p.peak_load_kw     = Number(form.peak_load_kw)
  if (form.building_size_m2) p.building_size_m2 = Number(form.building_size_m2)
  if (form.roof_area_m2)     p.roof_area_m2     = Number(form.roof_area_m2)
  if (form.pump_power_kw)    p.pump_power_kw    = Number(form.pump_power_kw)
  if (form.pump_hours_day)   p.pump_hours_day   = Number(form.pump_hours_day)
  if (form.ac_units)         p.ac_units         = Number(form.ac_units)
  return p
}

// ── SAR formatter ─────────────────────────────────────────────────────────────
const sar = v => v != null ? `${Number(v).toLocaleString()} SAR` : '—'

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Metric({ label, value, unit }) {
  return (
    <div style={S.metric}>
      <div style={S.metricLbl}>{label}</div>
      <div style={S.metricVal}>{value}</div>
      <div style={S.metricUnit}>{unit}</div>
    </div>
  )
}

function PanelCard({ item, selected, onSelect }) {
  const isSel = selected?.id === item.id
  const lblSt = LABEL_STYLES[item.recommendation_label] || {}
  return (
    <div
      style={{ ...(isSel ? { border: '2px solid #1D9E75', background: '#F0FBF7' } : { border: `0.5px solid ${C.border}`, background: C.white }), borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}
      onClick={() => onSelect(item)}
    >
      <div style={{ ...S.badge, ...lblSt }}>{item.recommendation_label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{item.brand}</div>
      <div style={{ fontSize: 11, color: C.gray, marginBottom: 10 }}>{item.model}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <tbody>
          {[
            ['Wattage',    `${item.power_wp} Wp`],
            ['Units',      `${item.units_required} panels`],
            ['Array size', `${item.actual_kwp} kWp`],
            ['Efficiency', `${item.efficiency_pct}%`],
            ['Type',       item.type],
            ['Roof area',  `${item.roof_area_m2} m²`],
            ['Warranty',   `${item.warranty_years} years`],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: C.gray, padding: '3px 0', paddingRight: 8 }}>{k}</td>
              <td style={{ fontWeight: 500, color: '#374151', textAlign: 'right' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginTop: 10, paddingTop: 8, borderTop: '0.5px solid #E5E7EB' }}>
        {item.panels_cost_sar?.toLocaleString()} SAR
      </div>
    </div>
  )
}

function InverterCard({ item, selected, onSelect }) {
  const isSel = selected?.id === item.id
  const lblSt = LABEL_STYLES[item.recommendation_label] || {}
  return (
    <div
      style={{ ...(isSel ? { border: '2px solid #1D9E75', background: '#F0FBF7' } : { border: `0.5px solid ${C.border}`, background: C.white }), borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}
      onClick={() => onSelect(item)}
    >
      <div style={{ ...S.badge, ...lblSt }}>{item.recommendation_label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{item.brand}</div>
      <div style={{ fontSize: 11, color: C.gray, marginBottom: 10 }}>{item.model}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <tbody>
          {[
            ['Capacity',   `${item.capacity_kw} kW / unit`],
            ['Units',      `${item.units_required} unit(s)`],
            ['Total kW',   `${item.actual_kw} kW`],
            ['Type',       item.type],
            ['Efficiency', `${item.efficiency_pct}%`],
            ['Warranty',   `${item.warranty_years} years`],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: C.gray, padding: '3px 0', paddingRight: 8 }}>{k}</td>
              <td style={{ fontWeight: 500, color: '#374151', textAlign: 'right' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginTop: 10, paddingTop: 8, borderTop: '0.5px solid #E5E7EB' }}>
        {item.inverter_cost_sar?.toLocaleString()} SAR
      </div>
    </div>
  )
}

function BatteryCard({ item, selected, onSelect }) {
  const isSel = selected?.id === item.id
  const lblSt = LABEL_STYLES[item.recommendation_label] || {}
  return (
    <div
      style={{ ...(isSel ? { border: '2px solid #1D9E75', background: '#F0FBF7' } : { border: `0.5px solid ${C.border}`, background: C.white }), borderRadius: 10, padding: '14px 16px', cursor: 'pointer' }}
      onClick={() => onSelect(item)}
    >
      <div style={{ ...S.badge, ...lblSt }}>{item.recommendation_label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{item.brand}</div>
      <div style={{ fontSize: 11, color: C.gray, marginBottom: 10 }}>{item.model}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <tbody>
          {[
            ['Capacity',   `${item.capacity_kwh} kWh / unit`],
            ['Units',      `${item.units_required} unit(s)`],
            ['Total kWh',  `${item.actual_kwh} kWh`],
            ['Chemistry',  item.chemistry],
            ['DoD',        `${item.dod_pct}%`],
            ['Cycle life', `${item.cycle_life?.toLocaleString()} cycles`],
            ['Warranty',   `${item.warranty_years} years`],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ color: C.gray, padding: '3px 0', paddingRight: 8 }}>{k}</td>
              <td style={{ fontWeight: 500, color: '#374151', textAlign: 'right' }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 14, fontWeight: 700, color: C.green, marginTop: 10, paddingTop: 8, borderTop: '0.5px solid #E5E7EB' }}>
        {item.battery_cost_sar?.toLocaleString()} SAR
      </div>
    </div>
  )
}

// ── Calculation details panel (expandable) ────────────────────────────────────
function CalcDetailsPanel({ snap }) {
  const [open, setOpen] = useState(false)
  if (!snap?.financials) return null
  const fin      = snap.financials
  const prod     = fin.annual_production_yr1_kwh
  const gridSav  = fin.annual_grid_savings_yr1_sar
  const rate     = prod > 0 ? (gridSav / prod) : 0
  const hasDemand = snap.demandSavings && snap.userType === 'facility'

  return (
    <div style={{ marginTop: 10 }}>
      <button style={S.detailsBtn} onClick={() => setOpen(o => !o)}>
        <span>{open ? '▲' : '▼'}</span>
        <span>How savings were calculated</span>
      </button>
      {open && (
        <div style={S.detailsPanel}>
          <div style={{ fontWeight: 600, color: '#111827', marginBottom: 10 }}>Year 1 breakdown</div>

          {/* Production */}
          {[
            ['PV array size',        `${snap.panel?.actual_kwp?.toFixed(1)} kWp`],
            ['Solar resource (GHI)', `${snap.systemProfile?.ghi} kWh/m²/day`],
            ['Performance ratio',    `${((snap.requirements?.performance_ratio || 0.655) * 100).toFixed(1)}%`],
          ].map(([k, v]) => (
            <div key={k} style={S.detailRow}>
              <span style={{ color: C.gray }}>{k}</span>
              <span style={{ fontWeight: 500 }}>{v}</span>
            </div>
          ))}
          <div style={{ ...S.detailRow, fontStyle: 'italic', color: C.gray }}>
            <span>{snap.panel?.actual_kwp?.toFixed(0)} × {snap.systemProfile?.ghi} × 365 × {(snap.requirements?.performance_ratio || 0.655).toFixed(3)} × degradation</span>
            <span style={{ fontWeight: 600, color: C.amber }}>= {prod?.toLocaleString()} kWh</span>
          </div>

          {/* Energy savings */}
          <div style={{ marginTop: 8 }}>
            <div style={S.detailRow}>
              <span style={{ color: C.gray }}>Grid savings</span>
              <span>{prod?.toLocaleString()} kWh × {rate.toFixed(3)} SAR/kWh</span>
            </div>
            <div style={{ ...S.detailRow, fontWeight: 500 }}>
              <span>Year 1 grid savings</span>
              <span style={{ color: C.green }}>{sar(gridSav)}</span>
            </div>
            {fin.annual_export_revenue_yr1_sar > 0 && (
              <div style={{ ...S.detailRow, fontWeight: 500 }}>
                <span>Net metering export revenue</span>
                <span style={{ color: C.blue }}>+{sar(fin.annual_export_revenue_yr1_sar)}</span>
              </div>
            )}
            {hasDemand && (
              <>
                <div style={{ ...S.detailRow, fontWeight: 500 }}>
                  <span>Demand charge savings (facility)</span>
                  <span style={{ color: C.amber }}>+{sar(snap.demandSavings.annual_demand_saving_sar)}</span>
                </div>
                <div style={{ ...S.detailRow, fontSize: 10, color: C.gray }}>
                  <span>{snap.demandSavings.assumption}</span>
                  <span>{snap.demandSavings.peak_reduction_kw} kW × 18 SAR × 12 months</span>
                </div>
              </>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 5px', fontWeight: 700, borderTop: '0.5px solid #D1D5DB', marginTop: 4 }}>
              <span>Total Year 1 savings</span>
              <span style={{ color: C.green }}>{sar(fin.year_1_savings_sar)}</span>
            </div>
          </div>

          {/* Assumptions */}
          <div style={{ marginTop: 10, padding: '8px 10px', background: C.white, borderRadius: 6, border: '0.5px solid #E5E7EB' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Key assumptions</div>
            <div style={{ fontSize: 10, color: C.gray, lineHeight: 1.7 }}>
              • SA grid CO₂ factor: 0.72 kg/kWh  • Temperature derating: −18%<br />
              • Dust/soiling loss: −7%  • System losses: −14%  • Panel degradation: −1%/yr<br />
              {hasDemand && '• Demand savings: facility only — actual depends on utility tariff structure\n'}
              • Indicative estimates only — not investment-grade analysis
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Co2Panel({ co2 }) {
  if (!co2) return null
  return (
    <div style={S.co2Card}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#085041', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Environmental contribution
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        {[
          [co2.yr1_co2_tonnes.toFixed(1),    'tonnes CO₂/year avoided'],
          [co2.yr10_co2_tonnes.toFixed(0),   'tonnes CO₂ over 10 years'],
          [co2.trees_equivalent.toLocaleString(), 'equivalent trees/yr'],
        ].map(([v, l]) => (
          <div key={l} style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#085041' }}>{v}</div>
            <div style={{ fontSize: 10, color: C.gray }}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: C.gray, marginTop: 8 }}>
        SA grid factor 0.72 kg CO₂/kWh. Supports Saudi Vision 2030 net-zero by 2060.
      </div>
    </div>
  )
}

function DemandPanel({ demandSavings }) {
  if (!demandSavings) return null
  return (
    <div style={S.demandCard}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Peak demand savings included (facility only)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#92400E' }}>{demandSavings.peak_reduction_kw} kW</div>
          <div style={{ fontSize: 10, color: C.gray }}>estimated peak reduction</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#92400E' }}>{sar(demandSavings.monthly_demand_saving_sar)}</div>
          <div style={{ fontSize: 10, color: C.gray }}>monthly demand saving</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#92400E' }}>{sar(demandSavings.annual_demand_saving_sar)}</div>
          <div style={{ fontSize: 10, color: C.gray }}>annual demand saving</div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: C.gray, lineHeight: 1.5 }}>
        Included in all savings figures above. {demandSavings.assumption}. Actual savings depend on your SEC tariff structure.
      </div>
    </div>
  )
}

// ── Simple Payback + ROI panel ────────────────────────────────────────────────
function PaybackPanel({ snap }) {
  const [open, setOpen] = useState(false)
  if (!snap?.financials || !snap?.capexBreakdown) return null

  const capex      = snap.capexBreakdown.total
  const fin        = snap.financials
  const yearlyData = fin.yearly_data || []
  const yr10net    = fin.net_10yr_benefit_sar
  const yr10cum    = fin.year_10_savings_sar

  // ── Payback: interpolated from yearly_data — same source as chart and banner ──
  // Find the two consecutive years that straddle the break-even point
  // (i.e. where cumulative savings cross CAPEX), then linearly interpolate.
  // This produces a decimal result that is mathematically consistent with the
  // integer break_even_year from computeFinancials and the chart intersection.
  //
  // Example: if savings at Yr 4 = 1.6M and savings at Yr 5 = 2.1M, CAPEX = 1.8M:
  //   fraction = (1.8M - 1.6M) / (2.1M - 1.6M) = 0.40
  //   payback  = 4 + 0.40 = 4.4 years  →  banner shows "Year 5", chart crosses between Yr4-Yr5
  let paybackYears = null
  let paybackCalcNote = ''

  if (yearlyData.length > 0) {
    // Find the first year where cumulative savings >= CAPEX
    const beyIdx = yearlyData.findIndex(d => d.cumulative_savings_sar >= capex)
    if (beyIdx === 0) {
      // Paid back within Year 1
      const fraction = capex / yearlyData[0].cumulative_savings_sar
      paybackYears = +(fraction).toFixed(1)
      paybackCalcNote = `Payback within Year 1 (CAPEX ÷ Yr1 cumulative savings)`
    } else if (beyIdx > 0) {
      const prevYr   = yearlyData[beyIdx - 1]
      const crossYr  = yearlyData[beyIdx]
      const savingsNeeded  = capex - prevYr.cumulative_savings_sar
      const savingsInYear  = crossYr.cumulative_savings_sar - prevYr.cumulative_savings_sar
      const fraction = savingsNeeded / savingsInYear
      paybackYears = +(prevYr.year + fraction).toFixed(1)
      paybackCalcNote = `Yr ${prevYr.year} savings: ${prevYr.cumulative_savings_sar.toLocaleString()} SAR → need ${savingsNeeded.toLocaleString()} more → ${(fraction * 100).toFixed(0)}% into Year ${crossYr.year}`
    } else {
      // Break-even not reached within 10 years — use simple linear projection from Yr1
      const yr1Annual = yearlyData[0]?.total_savings_sar || 1
      paybackYears = +(capex / yr1Annual).toFixed(1)
      paybackCalcNote = `Break-even beyond Year 10 — linear projection from Year 1 savings`
    }
  }

  const roi10yr    = yr10net != null && capex > 0 ? +((yr10net / capex) * 100).toFixed(1) : null
  const irr_approx = yr10cum != null && capex > 0 && yr10cum > 0
    ? +(((yr10cum / capex) ** (1 / 10) - 1) * 100).toFixed(1)
    : null

  const bey        = fin.break_even_year
  const isGood     = paybackYears != null && paybackYears <= 8

  return (
    <div style={{ marginTop: 14, padding: '14px 16px', background: '#F4F6F8', borderRadius: 8, border: '0.5px solid #D1D5DB' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>Investment returns</div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: paybackYears == null ? '#9CA3AF' : isGood ? '#1D9E75' : '#BA7517' }}>
              {paybackYears != null ? `${paybackYears} yrs` : '>10 yrs'}
            </div>
            <div style={{ fontSize: 10, color: '#6B7280' }}>Payback period</div>
            {bey && (
              <div style={{ fontSize: 9, color: '#9CA3AF', marginTop: 2 }}>
                (full year: {bey})
              </div>
            )}
          </div>
          <div style={{ width: '0.5px', background: '#D1D5DB' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: roi10yr != null && roi10yr >= 0 ? '#1D9E75' : '#A32D2D' }}>
              {roi10yr != null ? `${roi10yr >= 0 ? '+' : ''}${roi10yr}%` : '—'}
            </div>
            <div style={{ fontSize: 10, color: '#6B7280' }}>10yr ROI</div>
          </div>
          <div style={{ width: '0.5px', background: '#D1D5DB' }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#185FA5' }}>
              {irr_approx != null ? `~${irr_approx}%` : '—'}
            </div>
            <div style={{ fontSize: 10, color: '#6B7280' }}>Ann. return (CAGR)</div>
          </div>
        </div>
      </div>

      <button
        style={{ background: 'transparent', border: '0.5px solid #D1D5DB', borderRadius: 6, padding: '5px 12px', fontSize: 11, color: '#6B7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => setOpen(o => !o)}
      >
        <span>{open ? '▲' : '▼'}</span>
        <span>How these were calculated</span>
      </button>

      {open && (
        <div style={{ marginTop: 10, background: '#fff', borderRadius: 6, padding: '12px 14px', border: '0.5px solid #E5E7EB', fontSize: 11 }}>
          <div style={{ fontWeight: 600, color: '#111827', marginBottom: 8 }}>Calculation details</div>

          {/* Payback explanation */}
          <div style={{ borderBottom: '0.5px solid #F3F4F6', paddingBottom: 7, marginBottom: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6B7280' }}>Total CAPEX</span>
              <span style={{ fontFamily: 'monospace', color: '#374151' }}>{capex.toLocaleString()} SAR</span>
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Sum of all equipment + installation costs</div>
          </div>

          <div style={{ borderBottom: '0.5px solid #F3F4F6', paddingBottom: 7, marginBottom: 7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#6B7280' }}>Payback period</span>
              <span style={{ fontFamily: 'monospace', color: '#374151' }}>{paybackYears != null ? `${paybackYears} years` : '>10 years'}</span>
            </div>
            <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
              {paybackCalcNote}<br/>
              Interpolated from cumulative savings — same data as the break-even banner (Year {bey || '>'}) and the chart intersection.
              The decimal shows precisely where within that year the crossover occurs.
            </div>
          </div>

          {roi10yr != null && (
            <div style={{ borderBottom: '0.5px solid #F3F4F6', paddingBottom: 7, marginBottom: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6B7280' }}>10yr ROI</span>
                <span style={{ fontFamily: 'monospace', color: '#374151' }}>
                  ({yr10net >= 0 ? '+' : ''}{yr10net?.toLocaleString()} ÷ {capex.toLocaleString()}) × 100 = {roi10yr}%
                </span>
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>10yr net benefit as % of initial CAPEX investment</div>
            </div>
          )}

          {irr_approx != null && (
            <div style={{ paddingBottom: 7, marginBottom: 7 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6B7280' }}>Ann. return (CAGR)</span>
                <span style={{ fontFamily: 'monospace', color: '#374151' }}>
                  ({yr10cum?.toLocaleString()} ÷ {capex.toLocaleString()})^(1/10) − 1 = {irr_approx}%
                </span>
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Proxy for annualised return — not a true IRR (ignores reinvestment rate)</div>
            </div>
          )}

          <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 6, lineHeight: 1.5, borderTop: '0.5px solid #F3F4F6', paddingTop: 7 }}>
            All values derived from the same yearly financial model as the break-even banner and 10-year chart.
            Panel degradation 1%/yr applied. Stable tariff rates assumed. No O&amp;M costs modelled.
            These are indicative estimates — not investment-grade financial analysis.
          </div>
        </div>
      )}
    </div>
  )
}

// ── PDF / Print summary ───────────────────────────────────────────────────────
function handlePrint(snap, systemDesign) {
  if (!snap) return
  const fin        = snap.financials
  const capex      = snap.capexBreakdown.total
  const yearlyData = fin.yearly_data || []
  const roi10      = fin.net_10yr_benefit_sar != null && capex > 0
    ? (((fin.net_10yr_benefit_sar) / capex) * 100).toFixed(1)
    : '—'

  // Same interpolated payback logic as PaybackPanel — consistent with banner and chart
  let payback = '>10'
  const beyIdx = yearlyData.findIndex(d => d.cumulative_savings_sar >= capex)
  if (beyIdx === 0) {
    payback = (capex / yearlyData[0].cumulative_savings_sar).toFixed(1)
  } else if (beyIdx > 0) {
    const prev = yearlyData[beyIdx - 1]
    const curr = yearlyData[beyIdx]
    const fraction = (capex - prev.cumulative_savings_sar) / (curr.cumulative_savings_sar - prev.cumulative_savings_sar)
    payback = (prev.year + fraction).toFixed(1)
  } else if (yearlyData.length > 0) {
    payback = (capex / (yearlyData[0]?.total_savings_sar || 1)).toFixed(1)
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>SolarBrain — System Design Summary</title>
<style>
  body { font-family: -apple-system, Arial, sans-serif; margin: 32px; color: #111827; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #6B7280; font-size: 12px; margin-bottom: 24px; }
  h2 { font-size: 13px; font-weight: 700; margin: 20px 0 8px; border-bottom: 1px solid #E5E7EB; padding-bottom: 4px; color: #111827; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 0.5px solid #F3F4F6; }
  .lbl { color: #6B7280; }
  .val { font-weight: 600; }
  .green { color: #1D9E75; }
  .amber { color: #BA7517; }
  .big { display: flex; gap: 32px; margin: 12px 0; }
  .metric { text-align: center; }
  .metric .num { font-size: 22px; font-weight: 700; }
  .metric .lbl2 { font-size: 10px; color: #6B7280; margin-top: 2px; }
  .note { font-size: 10px; color: #9CA3AF; margin-top: 24px; line-height: 1.6; }
  .demand-box { background: #FFF8F0; border: 0.5px solid #FCD34D; border-radius: 6px; padding: 10px 14px; margin-top: 8px; }
  .co2-box { background: #F0FBF7; border: 0.5px solid #9FE1CB; border-radius: 6px; padding: 10px 14px; margin-top: 8px; }
  @media print { body { margin: 16px; } }
</style>
</head>
<body>
<h1>SolarBrain — System Design Summary</h1>
<div class="sub">
  ${snap.systemProfile?.region_name} &nbsp;|&nbsp;
  ${snap.systemProfile?.grid_scenario === 'on_grid' ? 'On-grid' : 'Off-grid'} &nbsp;|&nbsp;
  ${snap.userType?.charAt(0).toUpperCase() + snap.userType?.slice(1)} &nbsp;|&nbsp;
  Generated ${new Date().toLocaleDateString('en-SA')}
</div>

<h2>Selected Components</h2>
<div class="grid2">
<div>
  <div class="row"><span class="lbl">PV Panel</span><span class="val">${snap.panel?.brand} ${snap.panel?.model}</span></div>
  <div class="row"><span class="lbl">Array size</span><span class="val">${snap.panel?.actual_kwp} kWp (${snap.panel?.units_required} panels)</span></div>
  <div class="row"><span class="lbl">Panel efficiency</span><span class="val">${snap.panel?.efficiency_pct}%</span></div>
  <div class="row"><span class="lbl">Panel cost</span><span class="val">${snap.capexBreakdown.panelCost?.toLocaleString()} SAR</span></div>
</div>
<div>
  <div class="row"><span class="lbl">Inverter</span><span class="val">${snap.inverter?.brand} ${snap.inverter?.model}</span></div>
  <div class="row"><span class="lbl">Inverter capacity</span><span class="val">${snap.inverter?.actual_kw} kW (${snap.inverter?.units_required} unit(s))</span></div>
  <div class="row"><span class="lbl">Battery</span><span class="val">${snap.battery?.brand} ${snap.battery?.model}</span></div>
  <div class="row"><span class="lbl">Battery capacity</span><span class="val">${snap.battery?.actual_kwh} kWh (DoD ${snap.battery?.dod_pct}%)</span></div>
</div>
</div>

<h2>System Cost (CAPEX)</h2>
<div class="grid2">
<div>
  <div class="row"><span class="lbl">PV Panels</span><span class="val">${snap.capexBreakdown.panelCost?.toLocaleString()} SAR</span></div>
  <div class="row"><span class="lbl">Inverter(s)</span><span class="val">${snap.capexBreakdown.invCost?.toLocaleString()} SAR</span></div>
  <div class="row"><span class="lbl">Battery storage</span><span class="val">${snap.capexBreakdown.batCost?.toLocaleString()} SAR</span></div>
  <div class="row"><span class="lbl">Protection + BOS</span><span class="val">${(snap.capexBreakdown.protectionSar + snap.capexBreakdown.bosSar)?.toLocaleString()} SAR</span></div>
  <div class="row" style="font-weight:700"><span>Total CAPEX</span><span class="green">${capex?.toLocaleString()} SAR</span></div>
</div>
<div>
  <div class="row"><span class="lbl">Monthly savings</span><span class="val">${fin.monthly_savings_sar?.toLocaleString()} SAR</span></div>
  <div class="row"><span class="lbl">Year 1 savings</span><span class="val">${fin.year_1_savings_sar?.toLocaleString()} SAR</span></div>
  <div class="row"><span class="lbl">Year 5 savings</span><span class="val">${fin.year_5_savings_sar?.toLocaleString()} SAR</span></div>
  <div class="row"><span class="lbl">Year 10 savings</span><span class="val">${fin.year_10_savings_sar?.toLocaleString()} SAR</span></div>
  <div class="row" style="font-weight:700"><span>10yr net benefit</span>
    <span style="color:${fin.net_10yr_benefit_sar >= 0 ? '#1D9E75' : '#A32D2D'}">${fin.net_10yr_benefit_sar >= 0 ? '+' : ''}${fin.net_10yr_benefit_sar?.toLocaleString()} SAR</span></div>
</div>
</div>

<h2>Investment Returns</h2>
<div class="big">
  <div class="metric"><div class="num green">${payback} yrs</div><div class="lbl2">Simple payback</div></div>
  <div class="metric"><div class="num ${parseFloat(roi10) >= 0 ? 'green' : ''}">${parseFloat(roi10) >= 0 ? '+' : ''}${roi10}%</div><div class="lbl2">10-year ROI</div></div>
  ${fin.break_even_year ? `<div class="metric"><div class="num amber">Year ${fin.break_even_year}</div><div class="lbl2">Break-even</div></div>` : ''}
</div>

${snap.demandSavings ? `
<div class="demand-box">
  <strong>Peak demand savings (facility)</strong><br/>
  Estimated ${snap.demandSavings.peak_reduction_kw} kW peak reduction →
  ${snap.demandSavings.annual_demand_saving_sar?.toLocaleString()} SAR/year demand charge savings included in totals above.
</div>
` : ''}

${snap.co2 ? `
<div class="co2-box">
  <strong>Environmental contribution</strong><br/>
  ${snap.co2.yr1_co2_tonnes} tonnes CO₂/year avoided &nbsp;|&nbsp;
  ${snap.co2.yr10_co2_tonnes} tonnes over 10 years &nbsp;|&nbsp;
  Equivalent to planting ${snap.co2.trees_equivalent?.toLocaleString()} trees/year.
  Supports Saudi Vision 2030 net-zero by 2060.
</div>
` : ''}

<div class="note">
This summary is an indicative estimate based on IEC-standard sizing formulas with SA-specific derating factors.
Components are real products available in Saudi Arabia. Financial projections assume stable tariff rates and 1% annual panel degradation.
This is not investment-grade financial analysis. &nbsp;|&nbsp; Generated by SolarBrain — Intelligent Hybrid Energy Design System.
</div>
</body>
</html>`

  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write(html)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 400)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function DesignView() {
  const {
    systemDesign, setSystemDesign,
    selectedPanel,    setSelectedPanel,
    selectedInverter, setSelectedInverter,
    selectedBattery,  setSelectedBattery,
    designLoading, setDesignLoading,
    designError,   setDesignError,
    applyDefaultSelections,
    goToSimulation,
    formValues, setFormValues,
    finalDesignSnapshot, setFinalDesignSnapshot,
  } = useApp()

  // designStage: 'idle' | 'base' | 'final'
  // Initialized from store: if we already have a snapshot, show 'final'.
  // If we have a base design but no snapshot, show 'base'.
  const [designStage, setDesignStage] = useState(() => {
    if (finalDesignSnapshot) return 'final'
    if (systemDesign) return 'base'
    return 'idle'
  })

  const form    = formValues
  const setF    = (k, v) => setFormValues(prev => ({ ...prev, [k]: v }))
  const isRes   = form.user_type === 'residential'
  const isFarm  = form.user_type === 'farm'

  // ── Stage A: Generate Base Design ─────────────────────────────────────
  async function handleGenerateBase(e) {
    e.preventDefault()
    setDesignLoading(true)
    setDesignError(null)
    try {
      const data = await submitDesign(buildPayload(form))
      setSystemDesign(data.system_design)
      applyDefaultSelections(data.system_design)
      setDesignStage('base')
      // Clear old snapshot so Stage B doesn't show stale data
      setFinalDesignSnapshot(null)
    } catch (err) {
      setDesignError(err?.response?.data?.detail || err.message || 'Something went wrong')
    } finally {
      setDesignLoading(false)
    }
  }

  // ── Stage B: Generate Final Design ────────────────────────────────────
  // Does NOT call the backend again — computes everything in JS from selected
  // components and the current systemDesign. Then freezes into a snapshot.
  function handleGenerateFinal() {
    if (!systemDesign || !selectedPanel || !selectedInverter || !selectedBattery) return
    const snap = buildSnapshot({
      systemDesign,
      panel:    selectedPanel,
      inverter: selectedInverter,
      battery:  selectedBattery,
    })
    if (!snap.financials) {
      setDesignError('Could not compute financials for selected combination. Please check inputs.')
      return
    }
    setFinalDesignSnapshot(snap)
    setDesignStage('final')
  }

  // Convenience: live preview CAPEX while user browses Stage A cards
  const previewCapex = useMemo(() => {
    if (!systemDesign) return null
    const base    = systemDesign.capex_breakdown
    const pCost   = selectedPanel?.panels_cost_sar    ?? base.panels_sar
    const iCost   = selectedInverter?.inverter_cost_sar ?? base.inverter_sar
    const bCost   = selectedBattery?.battery_cost_sar   ?? base.battery_sar
    return pCost + iCost + bCost + base.protection_sar + base.bos_sar
  }, [systemDesign, selectedPanel, selectedInverter, selectedBattery])

  // The frozen snapshot for Stage B — never null once set, survives navigation
  const snap = finalDesignSnapshot

  return (
    <div style={S.page}>
      <div style={S.container}>

        <div style={S.header}>
          <h1 style={S.headerTitle}>SolarBrain — Hybrid Energy System Designer</h1>
          <p style={S.headerSub}>Design your complete solar hybrid system · Saudi Arabia</p>
        </div>

        {/* ═════════════════════ STAGE A: FORM ══════════════════════ */}
        <div style={S.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 10, borderBottom: '0.5px solid #E5E7EB' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Stage A — Facility Profile</span>
            <span style={{ ...S.badge, background: '#E6F1FB', color: '#0C447C' }}>Step 1 of 2</span>
          </div>
          <form onSubmit={handleGenerateBase}>

            <div style={{ ...S.grid3, marginBottom: 16 }}>
              <div style={S.formGroup}>
                <label style={S.label}>Facility type</label>
                <select style={S.select} value={form.user_type} onChange={e => setF('user_type', e.target.value)}>
                  <option value="facility">Industrial facility</option>
                  <option value="farm">Agricultural farm</option>
                  <option value="residential">Residential</option>
                </select>
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>SA region</label>
                <select style={S.select} value={form.region} onChange={e => setF('region', e.target.value)}>
                  <option value="eastern">Eastern Region (GHI 5.9)</option>
                  <option value="central">Central Region (GHI 6.2)</option>
                  <option value="western">Western Region (GHI 5.8)</option>
                </select>
              </div>
              <div style={S.formGroup}>
                <label style={S.label}>Grid scenario</label>
                <select style={S.select} value="on_grid" disabled>
                  <option value="on_grid">On-grid (grid-connected)</option>
                </select>
                <span style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>On-grid only</span>
              </div>
            </div>

            <div style={{ ...S.grid2, marginBottom: 16 }}>
              <div style={S.formGroup}>
                <label style={S.label}>Monthly electricity bill (SAR)</label>
                <input style={S.input} type="number" min="0" value={form.monthly_bill_sar} onChange={e => setF('monthly_bill_sar', e.target.value)} required />
              </div>
              {!isFarm && (
                <div style={S.formGroup}>
                  <label style={S.label}>{isRes ? 'Number of AC units' : 'Peak load (kW) — optional'}</label>
                  {isRes
                    ? <input style={S.input} type="number" min="1" value={form.ac_units} onChange={e => setF('ac_units', e.target.value)} />
                    : <input style={S.input} type="number" min="0" placeholder="Derived from bill if blank" value={form.peak_load_kw} onChange={e => setF('peak_load_kw', e.target.value)} />
                  }
                </div>
              )}
            </div>

            {isFarm && (
              <div style={{ ...S.grid2, marginBottom: 16 }}>
                <div style={S.formGroup}>
                  <label style={S.label}>Total pump power (kW)</label>
                  <input style={S.input} type="number" min="1" value={form.pump_power_kw} onChange={e => setF('pump_power_kw', e.target.value)} />
                </div>
                <div style={S.formGroup}>
                  <label style={S.label}>Pump hours per day</label>
                  <input style={S.input} type="number" min="1" max="24" value={form.pump_hours_day} onChange={e => setF('pump_hours_day', e.target.value)} />
                </div>
              </div>
            )}

            {!isFarm && (
              <div style={{ ...S.grid3, marginBottom: 16 }}>
                {!isRes && <div style={S.formGroup}>
                  <label style={S.label}>Operating hours / day</label>
                  <input style={S.input} type="number" min="1" max="24" value={form.operating_hours} onChange={e => setF('operating_hours', e.target.value)} />
                </div>}
                {!isRes && <div style={S.formGroup}>
                  <label style={S.label}>Critical load %</label>
                  <input style={S.input} type="number" min="0" max="100" placeholder="Default 30%" value={form.critical_load_pct} onChange={e => setF('critical_load_pct', e.target.value)} />
                </div>}
                <div style={S.formGroup}>
                  <label style={S.label}>Building size m² (optional)</label>
                  <input style={S.input} type="number" min="0" value={form.building_size_m2} onChange={e => setF('building_size_m2', e.target.value)} />
                </div>
                {isRes && <div style={S.formGroup}>
                  <label style={S.label}>Roof area m² (optional)</label>
                  <input style={S.input} type="number" min="0" value={form.roof_area_m2} onChange={e => setF('roof_area_m2', e.target.value)} />
                </div>}
              </div>
            )}

            {designError && <div style={S.error}>{designError}</div>}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="submit" style={designLoading ? S.btnDisabled : S.btnGreen} disabled={designLoading}>
                {designLoading && designStage !== 'final' ? 'Calculating…' : 'Generate Base Design'}
              </button>
              {designStage !== 'idle' && (
                <span style={{ fontSize: 12, color: C.gray }}>✓ Base design loaded — select your preferred components below</span>
              )}
            </div>
          </form>
        </div>

        {designLoading && (
          <div style={S.loading}>
            Calculating system sizing and generating data…<br />
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>This takes about 5–10 seconds</span>
          </div>
        )}

        {/* ═════════════════════ STAGE A OUTPUT: Requirements + Cards ══════════════════════ */}
        {systemDesign && !designLoading && (designStage === 'base' || designStage === 'final') && (
          <>
            {/* Sizing requirements */}
            <div style={S.card}>
              <div style={{ ...S.cardTitle, marginBottom: 12 }}>Sizing Requirements</div>
              <div style={S.metricGrid}>
                <Metric label="PV array required" value={systemDesign.requirements.pv_kwp_required.toFixed(0)} unit="kWp" />
                <Metric label="Battery required"  value={systemDesign.requirements.battery_kwh_required.toFixed(0)} unit="kWh" />
                <Metric label="Inverter minimum"  value={systemDesign.requirements.inverter_kw_required.toFixed(0)} unit="kW" />
                <Metric label="Load tier"         value={`Tier ${systemDesign.profile.tier}`} unit={`Peak ${systemDesign.profile.peak_load_kw} kW`} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={S.tag}>{systemDesign.profile.region_name}</span>
                <span style={S.tag}>GHI {systemDesign.profile.ghi} kWh/m²/day</span>
                <span style={S.tag}>Daily load {systemDesign.profile.daily_load_kwh.toFixed(0)} kWh</span>
                <span style={{ ...S.tag, background: systemDesign.profile.grid_scenario === 'on_grid' ? '#E6F1FB' : '#FAEEDA', color: systemDesign.profile.grid_scenario === 'on_grid' ? '#0C447C' : '#633806' }}>
                  {systemDesign.profile.grid_scenario === 'on_grid' ? 'On-grid' : 'Off-grid'}
                </span>
              </div>
            </div>

            {/* Component selection */}
            <div style={S.card}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, paddingBottom: 10, borderBottom: '0.5px solid #E5E7EB' }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Stage B — Select Your Components</span>
                <span style={{ ...S.badge, background: '#FAEEDA', color: '#633806' }}>Step 2 of 2</span>
              </div>
              <div style={S.infoBanner}>
                Select one option from each category below. Selections are <strong>pending</strong> until you click
                <strong> Generate Final Design</strong> — only then will the final financial report and chart be produced.
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={S.sectionLbl}>PV Panels</div>
                <div style={S.grid3}>
                  {systemDesign.panels.map(p => (
                    <PanelCard key={p.id} item={p} selected={selectedPanel} onSelect={setSelectedPanel} />
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={S.sectionLbl}>Inverter</div>
                <div style={S.grid3}>
                  {systemDesign.inverters.map(inv => (
                    <InverterCard key={inv.id} item={inv} selected={selectedInverter} onSelect={setSelectedInverter} />
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={S.sectionLbl}>Battery Storage</div>
                <div style={S.grid3}>
                  {systemDesign.batteries.map(bat => (
                    <BatteryCard key={bat.id} item={bat} selected={selectedBattery} onSelect={setSelectedBattery} />
                  ))}
                </div>
              </div>

              {/* Selection summary */}
              {selectedPanel && selectedInverter && selectedBattery && (
                <div style={{ background: C.lightBg, borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 6 }}>Selected combination (pending)</div>
                  <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.8 }}>
                    <strong>Panels:</strong> {selectedPanel.brand} {selectedPanel.model} — {selectedPanel.units_required} units → {selectedPanel.actual_kwp} kWp | {selectedPanel.panels_cost_sar?.toLocaleString()} SAR<br />
                    <strong>Inverter:</strong> {selectedInverter.brand} {selectedInverter.model} — {selectedInverter.units_required} × {selectedInverter.capacity_kw} kW | {selectedInverter.inverter_cost_sar?.toLocaleString()} SAR<br />
                    <strong>Battery:</strong> {selectedBattery.brand} {selectedBattery.model} — {selectedBattery.units_required} × {selectedBattery.capacity_kwh} kWh → {selectedBattery.actual_kwh} kWh | {selectedBattery.battery_cost_sar?.toLocaleString()} SAR
                  </div>
                  {previewCapex != null && (
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginTop: 8 }}>
                      Estimated CAPEX for selected combination: {previewCapex.toLocaleString()} SAR
                      <span style={{ fontSize: 10, fontWeight: 400, color: C.gray, marginLeft: 6 }}>(preview — not yet applied)</span>
                    </div>
                  )}
                </div>
              )}

              <button
                style={(!selectedPanel || !selectedInverter || !selectedBattery || designLoading) ? S.btnDisabled : S.btnAmber}
                disabled={!selectedPanel || !selectedInverter || !selectedBattery || designLoading}
                onClick={handleGenerateFinal}
              >
                Generate Final Design →
              </button>
            </div>
          </>
        )}

        {/* ═════════════════════ STAGE B OUTPUT: Final Design ══════════════════════ */}
        {/* Reads ONLY from finalDesignSnapshot — never re-reads live selection state.
            This is what makes the chart stable across navigation and new designs. */}
        {snap && snap.financials && designStage === 'final' && !designLoading && (
          <>
            <div style={{ ...S.infoBanner, marginBottom: 16 }}>
              <strong>Final design applied:</strong>&nbsp;
              {snap.panel?.brand} {snap.panel?.model} ({snap.panel?.actual_kwp} kWp) &nbsp;|&nbsp;
              {snap.inverter?.brand} {snap.inverter?.model} ({snap.inverter?.actual_kw} kW) &nbsp;|&nbsp;
              {snap.battery?.brand} {snap.battery?.model} ({snap.battery?.actual_kwh} kWh).
              &nbsp;Financial projections are indicative estimates — not investment-grade analysis.
            </div>

            {/* Diagram */}
            <div style={S.card}>
              <div style={S.cardTitle}>System Architecture Diagram</div>
              <p style={{ fontSize: 12, color: C.gray, marginBottom: 14 }}>
                Auto-generated from your selected components and system configuration.
              </p>
              <SystemDiagram />
            </div>

            {/* Financial report */}
            <div style={S.card}>
              <div style={S.cardTitle}>
                Financial Report — Final Selected Configuration
                <span style={{ fontSize: 10, fontWeight: 400, color: C.green, marginLeft: 8, background: '#E1F5EE', padding: '2px 6px', borderRadius: 4 }}>
                  Based on selected components
                </span>
                <button
                  onClick={() => handlePrint(snap, systemDesign)}
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F4F6F8', border: '0.5px solid #D1D5DB', borderRadius: 6, padding: '4px 10px', fontSize: 11, color: '#374151', cursor: 'pointer', float: 'right' }}
                >
                  🖨 Export PDF
                </button>
              </div>

              <div style={S.grid2}>
                {/* Left: CAPEX */}
                <div>
                  <div style={S.sectionLbl}>System cost breakdown</div>
                  {[
                    ['PV Panels',        snap.capexBreakdown.panelCost],
                    ['Inverter(s)',       snap.capexBreakdown.invCost],
                    ['Battery storage',  snap.capexBreakdown.batCost],
                    ['Protection items', snap.capexBreakdown.protectionSar],
                    ['Mounting & cable', snap.capexBreakdown.bosSar],
                  ].map(([label, val]) => (
                    <div key={label} style={S.finRow}>
                      <span style={{ color: C.gray }}>{label}</span>
                      <span>{Number(val).toLocaleString()} SAR</span>
                    </div>
                  ))}
                  <div style={S.finRowLast}>
                    <span>Total CAPEX</span>
                    <span style={{ color: C.green }}>{snap.capexBreakdown.total.toLocaleString()} SAR</span>
                  </div>
                </div>

                {/* Right: Savings */}
                <div>
                  <div style={S.sectionLbl}>
                    Projected savings — {snap.userType === 'facility' ? 'energy + demand (facility)' : 'indicative'}
                  </div>
                  {[
                    ['Monthly savings',    snap.financials.monthly_savings_sar],
                    ['Year 1 savings',     snap.financials.year_1_savings_sar],
                    ['Year 5 savings',     snap.financials.year_5_savings_sar],
                    ['Year 10 savings',    snap.financials.year_10_savings_sar],
                    ['10yr baseline cost', snap.financials.baseline_10yr_cost_sar],
                  ].map(([label, val]) => (
                    <div key={label} style={S.finRow}>
                      <span style={{ color: C.gray }}>{label}</span>
                      <span>{sar(val)}</span>
                    </div>
                  ))}
                  <div style={S.finRowLast}>
                    <span>10yr net benefit</span>
                    <span style={{ color: snap.financials.net_10yr_benefit_sar >= 0 ? C.green : C.red }}>
                      {sar(snap.financials.net_10yr_benefit_sar)}
                    </span>
                  </div>
                  {snap.financials.break_even_year && (
                    <div style={S.breakeven}>Break-even at Year {snap.financials.break_even_year}</div>
                  )}
                  <CalcDetailsPanel snap={snap} />
                  <PaybackPanel snap={snap} />
                </div>
              </div>

              {/* Demand panel — facility only */}
              <DemandPanel demandSavings={snap.demandSavings} />

              {/* CO2 */}
              <Co2Panel co2={snap.co2} />

              {/* 10-year chart
                  financials and capex both come from the frozen snapshot.
                  They never change unless the user clicks Generate Final again.
                  The chart cannot disappear because its data source is stable. */}
              <div style={{ marginTop: 24, paddingTop: 16, borderTop: '0.5px solid #E5E7EB' }}>
                <div style={S.sectionLbl}>10-year cost comparison</div>
                <p style={{ fontSize: 11, color: C.gray, marginBottom: 10 }}>
                  The lines converge at break-even — after that, the system is cheaper overall than continuing to pay utility bills.
                </p>
                <ROIChart
                  financials={snap.financials}
                  capex={snap.capexBreakdown.total}
                />
              </div>
            </div>

            {/* Run simulation */}
            <div style={{ textAlign: 'center', padding: '8px 0 32px' }}>
              <p style={{ color: C.gray, fontSize: 13, marginBottom: 6 }}>
                Final design ready. The simulation uses the recommended sizing configuration.
              </p>
              <button style={S.btnSim} onClick={goToSimulation}>
                Run Live Simulation →
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  )
}