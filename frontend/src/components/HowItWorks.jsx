/**
 * HowItWorks.jsx
 * Compact "How this system works" panel for judges arriving mid-demo.
 * Static content — no state, no API calls.
 * Used in SimulationView as a collapsible panel.
 */

import { useState } from 'react'

const STEPS = [
  {
    num: '1',
    color: '#BA7517',
    bg: '#FAEEDA',
    title: 'You describe your facility',
    desc: 'Enter your monthly bill, peak load, SA region, and grid scenario. The system derives your daily energy needs.',
  },
  {
    num: '2',
    color: '#1D9E75',
    bg: '#E1F5EE',
    title: 'Sizing engine designs the system',
    desc: 'IEC-standard formulas calculate the required PV array (kWp), battery storage (kWh), and inverter capacity (kW) using SA solar irradiance and local derating factors.',
  },
  {
    num: '3',
    color: '#185FA5',
    bg: '#E6F1FB',
    title: 'Real SA market components are selected',
    desc: 'The engine filters 36 real products available in Saudi Arabia by load tier and grid scenario, then scores and ranks them by efficiency, price, and warranty.',
  },
  {
    num: '4',
    color: '#534AB7',
    bg: '#F3F0FF',
    title: 'Synthetic dataset is generated',
    desc: 'A full-year dataset (35,000+ rows at 15-min intervals) is generated from your facility profile. It models SA solar curves, temperature derating, dust soiling, and shift-work load patterns across 3 seasons.',
  },
  {
    num: '5',
    color: '#0F1923',
    bg: '#F4F6F8',
    title: 'The switching brain decides in real time',
    desc: 'A stateful 7-mode rule engine reads solar output, battery SOC, grid price, and time of day every 15 seconds. It selects the optimal source, enforces battery depth-of-discharge limits, and applies hysteresis to prevent flickering.',
  },
  {
    num: '6',
    color: '#A32D2D',
    bg: '#FFF0F0',
    title: 'Scenarios stress-test the system',
    desc: 'Inject a grid outage, cloud cover event, or peak demand spike. The brain responds on the next decision cycle. The demo\'s most powerful moment is watching the failover happen live.',
  },
]

export default function HowItWorks() {
  const [open, setOpen] = useState(false)

  return (
    <div style={{
      background: '#fff', border: '0.5px solid #D1D5DB', borderRadius: 10,
      marginBottom: 14, overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', padding: '12px 16px', background: 'transparent',
          border: 'none', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          fontSize: 13, fontWeight: 600, color: '#111827',
        }}
      >
        <span>How this system works</span>
        <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 400 }}>
          {open ? '▲ collapse' : '▼ expand for judges'}
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 16px 16px', borderTop: '0.5px solid #E5E7EB' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 10, marginTop: 12,
          }}>
            {STEPS.map(s => (
              <div key={s.num} style={{
                background: s.bg, borderRadius: 8,
                border: `0.5px solid ${s.color}40`,
                padding: '12px 14px',
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: s.color,
                  textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
                }}>
                  Step {s.num}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111827', marginBottom: 4 }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 11, color: '#374151', lineHeight: 1.5 }}>
                  {s.desc}
                </div>
              </div>
            ))}
          </div>
          <div style={{
            marginTop: 12, padding: '8px 12px', background: '#F4F6F8',
            borderRadius: 6, fontSize: 11, color: '#6B7280', lineHeight: 1.5,
          }}>
            <strong style={{ color: '#374151' }}>Note for judges:</strong> The simulation uses
            synthetic data generated from your facility profile — not live IoT readings.
            It accurately models how the switching brain would behave on a real installed system.
            Real-time sensor integration is a planned next phase.
          </div>
        </div>
      )}
    </div>
  )
}