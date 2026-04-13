/**
 * SimulationView.jsx  (Stage 5 — final)
 * Adds: auto/manual toggle, HowItWorks panel, reset clears chart history,
 * active scenario badges, cleaner mode explanation,
 * history seeding from backend, dynamic load labels, always-visible net metering.
 */

import { useEffect, useRef, useCallback, useState } from 'react'
import { useApp } from '../store'
import {
  getNextStep, getHistory, injectScenario,
  setSpeed as apiSetSpeed, resetSimulation
} from '../api'
import HistoryChart from '../components/HistoryChart'
import HowItWorks from '../components/HowItWorks'

// ── Styles (same palette as before) ───────────────────────────────────────────
const S = {
  page: { minHeight: '100vh', background: '#f4f6f8', padding: '16px' },
  header: {
    background: '#0F1923', borderRadius: 12, padding: '14px 20px',
    marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  },
  headerTitle: { fontSize: 16, fontWeight: 600, color: '#fff', margin: 0 },
  modeChip: { padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700 },
  backBtn: {
    marginLeft: 'auto', background: 'transparent', border: '1px solid #2D4A3A',
    color: '#9FE1CB', borderRadius: 8, padding: '5px 14px', fontSize: 12, cursor: 'pointer',
  },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 },
  kpiCard: { background: '#fff', borderRadius: 10, border: '0.5px solid #D1D5DB', padding: '14px 16px' },
  kpiLabel: { fontSize: 11, color: '#6B7280', marginBottom: 4 },
  kpiValue: { fontSize: 22, fontWeight: 700, color: '#111827' },
  kpiUnit: { fontSize: 11, color: '#9CA3AF', marginTop: 3 },
  kpiSub: { fontSize: 11, color: '#6B7280', marginTop: 3 },
  card: { background: '#fff', borderRadius: 10, border: '0.5px solid #D1D5DB', padding: '14px 16px', marginBottom: 14 },
  cardTitle: { fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 12, paddingBottom: 8, borderBottom: '0.5px solid #E5E7EB' },
  flowRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  sourceBox: { flex: 1, minWidth: 90, borderRadius: 8, padding: '10px 12px', textAlign: 'center' },
  sourceName: { fontSize: 11, fontWeight: 600, marginBottom: 4 },
  sourceKw: { fontSize: 18, fontWeight: 700 },
  arrow: { fontSize: 20, color: '#9CA3AF', flexShrink: 0 },
  logItem: { padding: '8px 0', borderBottom: '0.5px solid #F3F4F6', fontSize: 12, lineHeight: 1.6 },
  logTime: { color: '#9CA3AF', fontFamily: 'monospace', fontSize: 11 },
  logMode: { fontWeight: 600, fontSize: 11, padding: '1px 6px', borderRadius: 4 },
  logReason: { color: '#374151', marginTop: 3, fontSize: 11 },
  scenBtn: { border: '0.5px solid #D1D5DB', borderRadius: 8, padding: '10px 12px', background: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%', fontSize: 12, lineHeight: 1.4 },
  scenBtnActive: { border: '1.5px solid #E24B4A', borderRadius: 8, padding: '10px 12px', background: '#FFF0F0', cursor: 'pointer', textAlign: 'left', width: '100%', fontSize: 12, lineHeight: 1.4 },
  scenTitle: { fontWeight: 600, color: '#111827', fontSize: 12 },
  scenDesc: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  controls: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  ctrlBtn: { border: '0.5px solid #D1D5DB', borderRadius: 8, padding: '8px 16px', background: '#fff', cursor: 'pointer', fontSize: 12 },
  ctrlBtnActive: { border: '0.5px solid #1D9E75', borderRadius: 8, padding: '8px 16px', background: '#E1F5EE', color: '#085041', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  progressBar: { height: 3, background: '#E5E7EB', borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: '100%', background: '#1D9E75', borderRadius: 2, transition: 'width 0.5s' },
  timeCtx: {
    background: '#fff', border: '0.5px solid #D1D5DB', borderRadius: 10,
    padding: '12px 16px', marginBottom: 14,
    display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 0,
  },
  timeItem: { textAlign: 'center', padding: '0 8px', borderRight: '0.5px solid #E5E7EB' },
  timeItemLast: { textAlign: 'center', padding: '0 8px' },
  timeLabel: { fontSize: 10, color: '#9CA3AF', marginBottom: 3 },
  timeValue: { fontSize: 14, fontWeight: 600, color: '#111827' },
  assumBanner: {
    background: '#F4F6F8', border: '0.5px solid #D1D5DB', borderRadius: 8,
    padding: '9px 14px', marginBottom: 14, fontSize: 11, color: '#6B7280', lineHeight: 1.5,
  },
  manualBtn: {
    background: '#0F1923', color: '#9FE1CB', border: 'none',
    borderRadius: 8, padding: '8px 20px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  activeBadge: {
    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
    background: '#E24B4A', color: '#fff', marginLeft: 4, verticalAlign: 'middle',
  },
}

const SOURCE_COLORS = {
  solar: { bg: '#FAEEDA', text: '#633806', border: '#EF9F27' },
  battery: { bg: '#E1F5EE', text: '#085041', border: '#1D9E75' },
  grid: { bg: '#E6F1FB', text: '#0C447C', border: '#378ADD' },
  generator: { bg: '#F3F4F6', text: '#374151', border: '#9CA3AF' },
  load: { bg: '#F3F0FF', text: '#3C3489', border: '#534AB7' },
}

const MODE_WHY = {
  SOLAR_ONLY: 'Solar is covering ≥92% of load — running on sun alone.',
  HYBRID: 'Solar covers part of load — grid fills the rest.',
  BATTERY_BACKUP: 'Peak pricing window active — battery discharging to avoid expensive grid draw.',
  EMERGENCY: 'Grid connection is down — critical loads protected by solar + battery.',
  CHARGE_MODE: 'Off-peak hours and battery is low — charging cheaply from the grid.',
  GRID_ONLY: 'Solar output below switching threshold — grid covers full load.',
  GENERATOR_BACKUP: 'Battery at minimum charge — generator activated to prevent blackout.',
}

function KpiCard({ label, value, unit, sub, color }) {
  return (
    <div style={S.kpiCard}>
      <div style={S.kpiLabel}>{label}</div>
      <div style={{ ...S.kpiValue, color: color || '#111827' }}>{value}</div>
      <div style={S.kpiUnit}>{unit}</div>
      {sub && <div style={S.kpiSub}>{sub}</div>}
    </div>
  )
}

function SourceBlock({ name, kw, colorKey }) {
  const c = SOURCE_COLORS[colorKey] || SOURCE_COLORS.grid
  return (
    <div style={{ ...S.sourceBox, background: c.bg, border: `1.5px solid ${c.border}` }}>
      <div style={{ ...S.sourceName, color: c.text }}>{name}</div>
      <div style={{ ...S.sourceKw, color: c.text }}>{(kw ?? 0).toFixed(1)} kW</div>
    </div>
  )
}

// ── Scenario definitions ──────────────────────────────────────────────────────
const SCENARIOS = [
  { id: 'grid_outage', restoreId: 'grid_restore', title: 'Grid outage', desc: 'Cut grid — EMERGENCY mode activates instantly' },
  { id: 'cloud_cover', restoreId: 'cloud_restore', title: 'Cloud cover event', desc: 'Solar drops 60% — HYBRID activates automatically' },
  { id: 'load_spike', restoreId: 'load_restore', title: 'Demand spike', desc: 'Add 30% extra load — brain rebalances sources' },
  { id: 'season_summer', restoreId: 'season_reset', title: 'Jump to summer', desc: 'Peak solar season — irradiance up to 1,000 W/m²' },
  { id: 'season_winter', restoreId: 'season_reset', title: 'Jump to winter', desc: 'Low solar period — grid dependency rises' },
  { id: 'low_battery', restoreId: 'low_battery_restore', title: 'Low battery', desc: 'Force SOC near floor — CHARGE_MODE activates' },
]

// ── Main component ────────────────────────────────────────────────────────────
export default function SimulationView() {
  const {
    systemDesign,
    simState, setSimState,
    simHistory, setSimHistory, pushHistory,
    simRunning, setSimRunning,
    simPaused, setSimPaused,
    simSpeed, setSimSpeed,
    goToDesign,
  } = useApp()

  const intervalRef = useRef(null)
  const [isManual, setIsManual] = useState(false)
  const [activeScen, setActiveScen] = useState(new Set())

  const userType = systemDesign?.profile?.user_type || 'facility'
  const loadLabel =
    userType === 'residential'
      ? 'Home load'
      : userType === 'farm'
        ? 'Farm load'
        : 'Facility load'

  // ── Polling ───────────────────────────────────────────────────────────────
  const fetchStep = useCallback(async () => {
    try {
      const data = await getNextStep()
      if (data.status === 'ok') {
        setSimState(data.state)
        pushHistory(data.state)
      }
    } catch (err) {
      console.error('Sim step error:', err)
    }
  }, [setSimState, pushHistory])

  const startPolling = useCallback(() => {
    if (isManual) return
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(fetchStep, 3000)
    setSimRunning(true)
    setSimPaused(false)
  }, [fetchStep, isManual, setSimRunning, setSimPaused])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setSimRunning(false)
    setSimPaused(true)
  }, [setSimRunning, setSimPaused])

  // Auto-start on mount (only in auto mode) + seed history from backend
  useEffect(() => {
    getHistory(96).then(data => {
      if (data?.history?.length > 0) {
        data.history.forEach(row => pushHistory(row))
      }
    }).catch(() => {})

    if (!isManual) startPolling()
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isManual, startPolling, pushHistory])

  // ── Manual step ───────────────────────────────────────────────────────────
  async function manualStep() {
    await fetchStep()
  }

  // ── Switch between auto and manual ───────────────────────────────────────
  function toggleMode() {
    if (!isManual) {
      stopPolling()
      setIsManual(true)
    } else {
      setIsManual(false)
    }
  }

  // ── Speed ─────────────────────────────────────────────────────────────────
  async function changeSpeed(s) {
    setSimSpeed(s)
    await apiSetSpeed(s)
  }

  // ── Reset — clears chart history ──────────────────────────────────────────
  async function handleReset() {
    stopPolling()
    await resetSimulation()
    setSimState(null)
    setSimHistory([])
    setActiveScen(new Set())

    getHistory(96).then(data => {
      if (data?.history?.length > 0) {
        data.history.forEach(row => pushHistory(row))
      }
    }).catch(() => {})

    if (!isManual) {
      setTimeout(startPolling, 200)
    }
  }

  // ── Scenario injection ────────────────────────────────────────────────────
  async function handleScenario(id) {
    await injectScenario(id)
    setActiveScen(prev => {
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  async function handleRestore(restoreId, triggerId) {
    await injectScenario(restoreId)
    setActiveScen(prev => {
      const next = new Set(prev)
      next.delete(triggerId)
      return next
    })
  }

  // ── Display values ────────────────────────────────────────────────────────
  const mode = simState?.mode || '—'
  const modeColor = simState?.mode_color || '#6B7280'
  const hour = simState?.hour ?? null
  const season = simState?.season ?? '—'
  const isPeak = hour !== null && hour >= 12 && hour <= 17
  const isOffPeak = hour !== null && (hour <= 6 || hour >= 22)

  const simTime = simState?.timestamp
    ? (() => {
        try {
          return new Date(simState.timestamp).toLocaleTimeString('en-SA', {
            hour: '2-digit',
            minute: '2-digit',
          })
        } catch {
          return '—'
        }
      })()
    : '—'

  return (
    <div style={S.page}>

      {/* Header */}
      <div style={S.header}>
        <h1 style={S.headerTitle}>Live Simulation Dashboard</h1>
        <div style={{ ...S.modeChip, background: modeColor + '22', color: modeColor, border: `1px solid ${modeColor}` }}>
          {mode.replace(/_/g, ' ')}
        </div>
        {simState?.mode_description && (
          <span style={{ color: '#9CA3AF', fontSize: 11 }}>{simState.mode_description}</span>
        )}
        <button
          style={S.backBtn}
          onClick={() => {
            stopPolling()
            goToDesign()
          }}
        >
          ← Back to design
        </button>
      </div>

      {/* How it works (collapsible) */}
      <HowItWorks />

      {/* Simulation assumption banner */}
      <div style={S.assumBanner}>
        <strong style={{ color: '#374151' }}>Simulation mode:</strong> Running on synthetic operational
        data generated from your facility profile. Models SA solar irradiance, temperature derating (−18%
        in summer), dust soiling (−7%), and shift-work load patterns. Accurately represents real system
        behavior — not live meter data.
        {activeScen.size > 0 && (
          <span style={{ marginLeft: 10, color: '#A32D2D', fontWeight: 600 }}>
            {activeScen.size} active scenario{activeScen.size > 1 ? 's' : ''} injected.
          </span>
        )}
      </div>

      {/* Time context */}
      <div style={S.timeCtx}>
        {[
          { label: 'Simulated time', value: simTime },
          { label: 'Season', value: season.charAt(0).toUpperCase() + season.slice(1) },
          { label: 'Price window', value: isPeak ? 'Peak' : isOffPeak ? 'Off-peak' : 'Shoulder', color: isPeak ? '#A32D2D' : isOffPeak ? '#185FA5' : '#374151' },
          { label: 'Grid price', value: simState?.grid_price_sar_kwh != null ? `${simState.grid_price_sar_kwh} SAR/kWh` : '—' },
          { label: 'Year progress', value: simState?.progress_pct != null ? `${simState.progress_pct.toFixed(1)}%` : '—' },
        ].map((item, i, arr) => (
          <div key={item.label} style={i < arr.length - 1 ? S.timeItem : S.timeItemLast}>
            <div style={S.timeLabel}>{item.label}</div>
            <div style={{ ...S.timeValue, color: item.color || '#111827' }}>{item.value}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div style={{ ...S.card, marginBottom: 14 }}>
        <div style={S.controls}>
          <span style={{ fontSize: 12, color: '#6B7280' }}>Mode:</span>
          <button style={!isManual ? S.ctrlBtnActive : S.ctrlBtn} onClick={() => !isManual || toggleMode()}>
            Auto
          </button>
          <button style={isManual ? S.ctrlBtnActive : S.ctrlBtn} onClick={() => isManual || toggleMode()}>
            Manual
          </button>

          <span style={{ width: 1, height: 20, background: '#E5E7EB', margin: '0 4px' }} />

          {!isManual && (
            <>
              <button
                style={simPaused ? S.ctrlBtnActive : S.ctrlBtn}
                onClick={simRunning ? stopPolling : startPolling}
              >
                {simRunning ? '⏸ Pause' : '▶ Resume'}
              </button>
              <span style={{ fontSize: 12, color: '#6B7280' }}>Speed:</span>
              {[1, 5, 10].map(s => (
                <button
                  key={s}
                  style={simSpeed === s ? S.ctrlBtnActive : S.ctrlBtn}
                  onClick={() => changeSpeed(s)}
                >
                  {s}×
                </button>
              ))}
            </>
          )}

          {isManual && (
            <button style={S.manualBtn} onClick={manualStep}>
              ▶ Step forward (1 decision cycle)
            </button>
          )}

          <button style={{ ...S.ctrlBtn, marginLeft: 'auto' }} onClick={handleReset}>
            ↺ Reset
          </button>
        </div>

        {simState && (
          <div style={S.progressBar}>
            <div style={{ ...S.progressFill, width: `${simState.progress_pct || 0}%` }} />
          </div>
        )}

        {isManual && (
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 8 }}>
            Manual mode: click &quot;Step forward&quot; to advance one 15-minute decision cycle at a time.
            Useful for walking judges through each decision individually.
          </div>
        )}
      </div>

      {/* KPI row 1 */}
      <div style={S.grid4}>
        <KpiCard label="Current mode" value={mode.replace(/_/g, ' ')} unit={simState?.season || '—'} color={modeColor} />
        <KpiCard
          label="Battery SOC"
          value={simState ? `${simState.battery_soc_pct}%` : '—'}
          unit="State of charge"
          sub={
            simState?.battery_discharge_kw > 0
              ? `Discharging ${simState.battery_discharge_kw.toFixed(1)} kW`
              : simState?.battery_charge_kw > 0
                ? `Charging ${simState.battery_charge_kw.toFixed(1)} kW`
                : 'Idle'
          }
          color={simState?.battery_soc_pct < 20 ? '#E24B4A' : '#1D9E75'}
        />
        <KpiCard label="Grid cost so far" value={simState ? simState.total_cost_sar.toLocaleString() : '—'} unit="SAR" color="#BA7517" />
        <KpiCard label="CO₂ avoided" value={simState ? simState.total_co2_saved_kg.toFixed(0) : '—'} unit="kg vs grid baseline" color="#1D9E75" />
      </div>

      {/* KPI row 2 */}
      <div style={S.grid4}>
        <KpiCard label="Solar output" value={simState ? `${simState.pv_output_kw.toFixed(1)} kW` : '—'} unit={`Utilization: ${simState?.solar_utilization_pct || 0}%`} />
        <KpiCard label={loadLabel} value={simState ? `${simState.load_kw.toFixed(1)} kW` : '—'} unit={`Grid dependency: ${simState?.grid_dependency_pct || 0}%`} />
        <KpiCard label="Grid draw" value={simState ? `${simState.grid_kw.toFixed(1)} kW` : '—'} unit="From utility grid" color={!simState?.grid_available ? '#E24B4A' : '#185FA5'} />
        <KpiCard label="Solar total" value={simState ? `${simState.total_solar_kwh.toFixed(0)} kWh` : '—'} unit="Generated this session" color="#BA7517" />
      </div>

      {/* Energy flow */}
      <div style={S.card}>
        <div style={S.cardTitle}>Live energy flow</div>
        {simState ? (
          <>
            <div style={S.flowRow}>
              <SourceBlock name="Solar PV" kw={simState.solar_kw} colorKey="solar" />
              <div style={S.arrow}>+</div>
              <SourceBlock name="Battery" kw={simState.battery_discharge_kw} colorKey="battery" />
              <div style={S.arrow}>+</div>
              <SourceBlock name="Grid" kw={simState.grid_kw} colorKey="grid" />
              {simState.generator_kw > 0 && (
                <>
                  <div style={S.arrow}>+</div>
                  <SourceBlock name="Generator" kw={simState.generator_kw} colorKey="generator" />
                </>
              )}
              <div style={S.arrow}>→</div>
              <SourceBlock name={loadLabel} kw={simState.load_kw} colorKey="load" />
            </div>
            <div style={{
              marginTop: 10, padding: '8px 12px', background: '#F4F6F8',
              borderRadius: 6, fontSize: 12, color: '#374151'
            }}>
              <strong>Why {mode.replace(/_/g, ' ')}?</strong>&nbsp;
              {MODE_WHY[simState.mode] || simState.mode_description}
            </div>
          </>
        ) : (
          <p style={{ color: '#9CA3AF', fontSize: 13 }}>Waiting for first simulation step…</p>
        )}
      </div>

      {/* Net metering (on-grid only) — positioned below energy flow, above history chart */}
      {systemDesign?.profile?.grid_scenario === 'on_grid' && (
        <div style={{ ...S.card, borderColor: '#B5D4F4' }}>
          <div style={S.cardTitle}>Net metering</div>
          <div style={{ display: 'flex', gap: 24 }}>
            <div>
              <div style={S.kpiLabel}>Exporting to grid</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#185FA5' }}>
                {(simState?.grid_export_kw ?? 0).toFixed(1)} kW
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>
                Active when battery full and solar surplus
              </div>
            </div>
            <div>
              <div style={S.kpiLabel}>Revenue earned (session)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#185FA5' }}>
                {(simState?.total_net_meter_sar ?? 0).toFixed(2)} SAR
              </div>
              <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 3 }}>
                @ {systemDesign?.profile?.user_type === 'residential' ? '0.09' : '0.12–0.16'} SAR/kWh export rate
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 24h history chart */}
      <div style={S.card}>
        <div style={S.cardTitle}>24-hour energy history</div>
        <HistoryChart />
      </div>

      {/* Decision log + Scenario panel */}
      <div style={S.grid2}>

        {/* Decision log */}
        <div style={S.card}>
          <div style={S.cardTitle}>Decision log</div>
          {simState?.recent_decisions?.length > 0 ? (
            [...simState.recent_decisions].reverse().map((d, i) => (
              <div key={i} style={S.logItem}>
                <div>
                  <span style={S.logTime}>{d.timestamp?.slice(11, 16)}</span>{' '}
                  <span style={{ ...S.logMode, background: '#F3F4F6', color: '#374151' }}>
                    {d.from_mode?.replace(/_/g, ' ')}
                  </span>
                  {' → '}
                  <span style={{ ...S.logMode, background: '#E1F5EE', color: '#085041' }}>
                    {d.to_mode?.replace(/_/g, ' ')}
                  </span>
                </div>
                <div style={S.logReason}>{d.reason}</div>
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                  Battery at {d.battery_soc}% when decision was made
                </div>
              </div>
            ))
          ) : (
            <p style={{ color: '#9CA3AF', fontSize: 12 }}>
              Log updates when the brain switches modes.
              Switches confirmed after 2 consecutive cycles (30 simulated minutes).
            </p>
          )}
        </div>

        {/* Scenario panel */}
        <div style={S.card}>
          <div style={S.cardTitle}>Scenario injection</div>
          <p style={{ fontSize: 11, color: '#6B7280', marginBottom: 10 }}>
            Inject events into the running simulation. The brain responds on the next
            decision cycle (every 3 seconds in auto mode, or next manual step).
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {SCENARIOS.map(sc => {
              const isActive = activeScen.has(sc.id)
              return (
                <div key={sc.id} style={{ display: 'flex', gap: 6 }}>
                  <button
                    style={isActive ? S.scenBtnActive : S.scenBtn}
                    onClick={() => handleScenario(sc.id)}
                  >
                    <div style={S.scenTitle}>
                      {sc.title}
                      {isActive && <span style={S.activeBadge}>ACTIVE</span>}
                    </div>
                    <div style={S.scenDesc}>{sc.desc}</div>
                  </button>
                  {sc.restoreId && (
                    <button
                      style={{
                        ...S.scenBtn,
                        width: 'auto',
                        padding: '10px 10px',
                        color: '#6B7280',
                        flexShrink: 0,
                        opacity: isActive ? 1 : 0.4,
                      }}
                      onClick={() => handleRestore(sc.restoreId, sc.id)}
                      title="Restore to normal"
                    >
                      ↺
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

    </div>
  )
}