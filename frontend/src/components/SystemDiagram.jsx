/**
 * SystemDiagram.jsx
 * Auto-generated block diagram of the physical hybrid energy system.
 * Uses React Flow with a fixed layout — no drag/drop needed.
 * Rendered in DesignView after the system design is complete.
 */

import ReactFlow, {
  Background, Controls, MarkerType, Handle, Position,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useApp } from '../store'
import { useMemo } from 'react'

// ── Node colors matching the rest of the UI ───────────────────────────────────
const NODE_THEMES = {
  pv:         { bg: '#FAEEDA', border: '#BA7517', text: '#633806' },
  inverter:   { bg: '#E1F5EE', border: '#1D9E75', text: '#085041' },
  battery:    { bg: '#E6F1FB', border: '#185FA5', text: '#0C447C' },
  controller: { bg: '#0F1923', border: '#9FE1CB', text: '#9FE1CB' },
  grid:       { bg: '#F3F4F6', border: '#9CA3AF', text: '#374151' },
  generator:  { bg: '#FFF7ED', border: '#D97706', text: '#92400E' },
  load:       { bg: '#F3F0FF', border: '#534AB7', text: '#3C3489' },
}

// ── Custom node component ─────────────────────────────────────────────────────
function EnergyNode({ data }) {
  const t = NODE_THEMES[data.theme] || NODE_THEMES.grid
  return (
    <div
      style={{
        background: t.bg,
        border: `1.5px solid ${t.border}`,
        borderRadius: 10,
        padding: '10px 14px',
        minWidth: 130,
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: t.border, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: t.border, width: 8, height: 8 }} />
      <Handle type="target" position={Position.Top} style={{ background: t.border, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} style={{ background: t.border, width: 8, height: 8 }} />

      <div style={{ fontSize: 11, fontWeight: 700, color: t.text, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        {data.category}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>
        {data.label}
      </div>
      {data.spec && (
        <div style={{ fontSize: 10, color: t.text, opacity: 0.75, marginTop: 4, lineHeight: 1.4 }}>
          {data.spec}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { energy: EnergyNode }

const EDGE_STYLE = color => ({
  stroke: color,
  strokeWidth: 2,
  markerEnd: { type: MarkerType.ArrowClosed, color },
})

// ── Build nodes and edges from system design ──────────────────────────────────
function buildGraph(design, simState, selectedPanel, selectedInverter, selectedBattery) {
  if (!design) return { nodes: [], edges: [] }

  const prof = design.profile
  const panel = selectedPanel || design.panels?.[0]
  const inv = selectedInverter || design.inverters?.[0]
  const bat = selectedBattery || design.batteries?.[0]
  const isOnGrid = prof?.grid_scenario === 'on_grid'
  const hasGen = design.generator !== null && design.generator !== undefined

  const LOAD_EXAMPLES = {
    residential: {
      critical: 'Fridge, lighting, router, essential AC',
      shiftable: 'Laundry, water heater, secondary cooling',
    },
    farm: {
      critical: 'Irrigation controller, water pumps',
      shiftable: 'Secondary pumping, non-urgent equipment',
    },
    facility: {
      critical: 'Servers, safety systems, core production',
      shiftable: 'HVAC, compressors, non-critical lines',
    },
  }

  const loadEx = LOAD_EXAMPLES[prof?.user_type] || LOAD_EXAMPLES.facility

  // Animate edge widths based on live simulation state
  const pvKw = simState?.pv_output_kw ?? 0
  const gKw = simState?.grid_kw ?? 0
  const bKw = simState?.battery_discharge_kw ?? 0
  const lKw = simState?.load_kw ?? 0
  const genKw = simState?.generator_kw ?? 0

  const edgeWidth = (kw, base = 2) => Math.min(6, base + Math.round(kw / 50))

  const nodes = [
    {
      id: 'pv',
      type: 'energy',
      position: { x: 40, y: 80 },
      data: {
        category: 'PV Array',
        label: panel ? `${panel.actual_kwp} kWp` : 'Solar panels',
        spec: panel ? `${panel.brand} ${panel.model}` : '',
        theme: 'pv',
      },
    },
    {
      id: 'inv',
      type: 'energy',
      position: { x: 280, y: 80 },
      data: {
        category: 'Inverter',
        label: inv ? inv.brand : 'Inverter',
        spec: inv ? `${inv.model}  |  ${inv.actual_kw ?? inv.capacity_kw} kW` : '',
        theme: 'inverter',
      },
    },
    {
      id: 'bat',
      type: 'energy',
      position: { x: 40, y: 240 },
      data: {
        category: 'Battery',
        label: bat ? bat.brand : 'Battery',
        spec: bat ? `${bat.model}  |  ${bat.actual_kwh ?? bat.capacity_kwh} kWh` : '',
        theme: 'battery',
      },
    },
    {
      id: 'ctrl',
      type: 'energy',
      position: { x: 280, y: 240 },
      data: {
        category: 'Smart Controller',
        label: 'Switching brain',
        spec: '7-mode rule engine',
        theme: 'controller',
      },
    },
    {
      id: 'crit',
      type: 'energy',
      position: { x: 520, y: 80 },
      data: {
        category: 'Critical loads',
        label: `${prof?.critical_load_pct ?? 30}% of load`,
        spec: loadEx.critical,
        theme: 'load',
      },
    },
    {
      id: 'shift',
      type: 'energy',
      position: { x: 520, y: 240 },
      data: {
        category: 'Shiftable loads',
        label: '~25% of load',
        spec: loadEx.shiftable,
        theme: 'load',
      },
    },
  ]

  if (isOnGrid) {
    nodes.push({
      id: 'grid',
      type: 'energy',
      position: { x: 40, y: 400 },
      data: {
        category: 'Utility grid',
        label: 'SEC grid',
        spec: 'Backup + net metering',
        theme: 'grid',
      },
    })
  }

  if (hasGen && !isOnGrid) {
    nodes.push({
      id: 'gen',
      type: 'energy',
      position: { x: 40, y: 400 },
      data: {
        category: 'Generator',
        label: `${design.generator?.kva ?? '?'} kVA`,
        spec: 'Diesel backup',
        theme: 'generator',
      },
    })
  }

  const edges = [
    {
      id: 'pv-inv',
      source: 'pv',
      target: 'inv',
      label: 'DC power',
      style: { ...EDGE_STYLE('#BA7517'), strokeWidth: edgeWidth(pvKw) },
      labelStyle: { fontSize: 10, fill: '#BA7517' },
      labelBgStyle: { fill: '#FAEEDA' },
    },
    {
      id: 'bat-ctrl',
      source: 'bat',
      target: 'ctrl',
      label: 'Charge/discharge',
      style: { ...EDGE_STYLE('#185FA5'), strokeWidth: edgeWidth(bKw) },
      labelStyle: { fontSize: 10, fill: '#185FA5' },
      labelBgStyle: { fill: '#E6F1FB' },
    },
    {
      id: 'inv-ctrl',
      source: 'inv',
      target: 'ctrl',
      label: 'AC bus',
      style: EDGE_STYLE('#1D9E75'),
      labelStyle: { fontSize: 10, fill: '#1D9E75' },
      labelBgStyle: { fill: '#E1F5EE' },
    },
    {
      id: 'ctrl-crit',
      source: 'ctrl',
      target: 'crit',
      label: 'Always on',
      style: { ...EDGE_STYLE('#534AB7'), strokeWidth: edgeWidth(lKw * 0.3) },
      labelStyle: { fontSize: 10, fill: '#534AB7' },
      labelBgStyle: { fill: '#F3F0FF' },
    },
    {
      id: 'ctrl-shift',
      source: 'ctrl',
      target: 'shift',
      label: 'Dispatch',
      style: { ...EDGE_STYLE('#534AB7'), strokeWidth: edgeWidth(lKw * 0.25) },
      labelStyle: { fontSize: 10, fill: '#534AB7' },
      labelBgStyle: { fill: '#F3F0FF' },
    },
    {
      id: 'inv-bat',
      source: 'inv',
      target: 'bat',
      label: 'Charge',
      style: { ...EDGE_STYLE('#1D9E75'), strokeDasharray: '4 3' },
      labelStyle: { fontSize: 10, fill: '#1D9E75' },
      labelBgStyle: { fill: '#E1F5EE' },
    },
  ]

  if (isOnGrid) {
    edges.push({
      id: 'grid-ctrl',
      source: 'grid',
      target: 'ctrl',
      label: 'Backup supply',
      style: { ...EDGE_STYLE('#9CA3AF'), strokeWidth: edgeWidth(gKw) },
      labelStyle: { fontSize: 10, fill: '#6B7280' },
      labelBgStyle: { fill: '#F3F4F6' },
    })
    edges.push({
      id: 'ctrl-grid',
      source: 'ctrl',
      target: 'grid',
      label: 'Net metering',
      style: { ...EDGE_STYLE('#9CA3AF'), strokeDasharray: '4 3' },
      labelStyle: { fontSize: 10, fill: '#6B7280' },
      labelBgStyle: { fill: '#F3F4F6' },
    })
  }

  if (hasGen && !isOnGrid) {
    edges.push({
      id: 'gen-ctrl',
      source: 'gen',
      target: 'ctrl',
      label: 'Generator output',
      style: { ...EDGE_STYLE('#D97706'), strokeWidth: edgeWidth(genKw) },
      labelStyle: { fontSize: 10, fill: '#D97706' },
      labelBgStyle: { fill: '#FFF7ED' },
    })
  }

  return { nodes, edges }
}

// ── Main component ────────────────────────────────────────────────────────────
export default function SystemDiagram() {
  const {
    systemDesign,
    simState,
    selectedPanel,
    selectedInverter,
    selectedBattery,
  } = useApp()

  const { nodes, edges } = useMemo(
    () => buildGraph(systemDesign, simState, selectedPanel, selectedInverter, selectedBattery),
    [systemDesign, simState, selectedPanel, selectedInverter, selectedBattery]
  )

  if (!systemDesign) return null

  return (
    <div
      style={{
        height: 480,
        borderRadius: 10,
        overflow: 'hidden',
        border: '0.5px solid #D1D5DB',
        background: '#fafafa',
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnDrag={false}
        attributionPosition="bottom-right"
      >
        <Background color="#E5E7EB" gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}