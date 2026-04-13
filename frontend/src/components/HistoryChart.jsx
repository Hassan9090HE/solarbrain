/**
 * HistoryChart.jsx
 * Simple 24-hour line chart using simHistory from store.
 */

import { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import { Line } from 'react-chartjs-2'
import { useApp } from '../store'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend
)

export default function HistoryChart() {
  const { simHistory, systemDesign } = useApp()

  const userType = systemDesign?.profile?.user_type || 'facility'
  const loadLabel =
    userType === 'residential'
      ? 'Home load'
      : userType === 'farm'
        ? 'Farm load'
        : 'Facility load'

  const recent = useMemo(() => simHistory.slice(-96), [simHistory])

  const labels = useMemo(() => {
    return recent.map((s, i) => {
      if (s?.timestamp) {
        const d = new Date(s.timestamp)
        if (!isNaN(d)) {
          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        }
      }
      const h = s?.hour ?? i
      return `${String(h).padStart(2, '0')}:00`
    })
  }, [recent])

  const solar = useMemo(
    () => recent.map(s => Number(s?.solar_kw ?? s?.pv_output_kw ?? 0)),
    [recent]
  )

  const battery = useMemo(
    () => recent.map(s => Number(s?.battery_discharge_kw ?? 0)),
    [recent]
  )

  const grid = useMemo(
    () => recent.map(s => Number(s?.grid_kw ?? 0)),
    [recent]
  )

  const load = useMemo(
    () => recent.map(s => Number(s?.load_kw ?? s?.facility_load_kw ?? 0)),
    [recent]
  )

  const hasAnyData = useMemo(() => {
    const all = [...solar, ...battery, ...grid, ...load]
    return all.some(v => Number(v) > 0)
  }, [solar, battery, grid, load])

  if (recent.length < 2 || !hasAnyData) {
    return (
      <div
        style={{
          height: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#9CA3AF',
          fontSize: 13,
        }}
      >
        Waiting for chart data...
      </div>
    )
  }

  const data = {
    labels,
    datasets: [
      {
        label: 'Solar',
        data: solar,
        borderColor: '#BA7517',
        backgroundColor: 'rgba(186,117,23,0.20)',
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        borderWidth: 2,
      },
      {
        label: 'Battery discharge',
        data: battery,
        borderColor: '#1D9E75',
        backgroundColor: 'rgba(29,158,117,0.14)',
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        borderWidth: 2,
      },
      {
        label: 'Grid draw',
        data: grid,
        borderColor: '#185FA5',
        backgroundColor: 'rgba(24,95,165,0.12)',
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        borderWidth: 2,
      },
      {
        label: loadLabel,
        data: load,
        borderColor: '#534AB7',
        backgroundColor: 'transparent',
        fill: false,
        pointRadius: 0,
        tension: 0.3,
        borderWidth: 2,
        borderDash: [6, 4],
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0F1923',
        titleColor: '#9FE1CB',
        bodyColor: '#E5E7EB',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        ticks: {
          color: '#9CA3AF',
          maxTicksLimit: 12,
          maxRotation: 0,
          autoSkip: true,
          font: { size: 10 },
        },
        grid: { color: 'rgba(0,0,0,0.04)' },
      },
      y: {
        beginAtZero: true,
        ticks: {
          color: '#9CA3AF',
          font: { size: 10 },
          callback: value => `${value} kW`,
        },
        grid: { color: 'rgba(0,0,0,0.06)' },
      },
    },
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
        {[
          { color: '#BA7517', label: 'Solar', fill: true },
          { color: '#1D9E75', label: 'Battery discharge', fill: true },
          { color: '#185FA5', label: 'Grid draw', fill: true },
          { color: '#534AB7', label: loadLabel, fill: false },
        ].map(({ color, label, fill }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: fill ? 2 : 0,
                background: fill ? color : 'transparent',
                border: fill ? 'none' : `2px dashed ${color}`,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, color: '#6B7280' }}>{label}</span>
          </div>
        ))}
      </div>

      <div style={{ height: 220, position: 'relative' }}>
        <Line key={recent.length} data={data} options={options} redraw />
      </div>
    </>
  )
}