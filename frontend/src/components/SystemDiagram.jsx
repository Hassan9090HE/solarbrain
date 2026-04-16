/**
 * SystemDiagram.jsx
 * Fixed layout: Grid node is in the same column as PV/Battery (left column),
 * so the Grid↔Controller vertical edges are truly vertical and never orphaned.
 * All same-row node pairs use left/right handles for clean horizontal edges.
 */

import ReactFlow, {
  Background, Controls, MarkerType, Handle, Position,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useApp } from '../store'
import { useMemo } from 'react'

const NODE_THEMES = {
  pv:         { bg: '#FAEEDA', border: '#BA7517', text: '#633806' },
  inverter:   { bg: '#E1F5EE', border: '#1D9E75', text: '#085041' },
  battery:    { bg: '#E6F1FB', border: '#185FA5', text: '#0C447C' },
  controller: { bg: '#0F1923', border: '#9FE1CB', text: '#9FE1CB' },
  grid:       { bg: '#F3F4F6', border: '#9CA3AF', text: '#374151' },
  load:       { bg: '#F3F0FF', border: '#534AB7', text: '#3C3489' },
}

function EnergyNode({ data }) {
  const t = NODE_THEMES[data.theme] || NODE_THEMES.grid
  return (
    <div style={{
      background: t.bg, border: `1.5px solid ${t.border}`, borderRadius: 10,
      padding: '10px 14px', minWidth: 160, maxWidth: 220, textAlign: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <Handle id="left"   type="target" position={Position.Left}   style={{ background: t.border, width: 8, height: 8 }} />
      <Handle id="right"  type="source" position={Position.Right}  style={{ background: t.border, width: 8, height: 8 }} />
      <Handle id="top"    type="target" position={Position.Top}    style={{ background: t.border, width: 8, height: 8 }} />
      <Handle id="bottom" type="source" position={Position.Bottom} style={{ background: t.border, width: 8, height: 8 }} />
      <div style={{ fontSize: 11, fontWeight: 700, color: t.text, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
        {data.category}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{data.label}</div>
      {data.spec && (
        <div style={{ fontSize: 10, color: t.text, opacity: 0.75, marginTop: 4, lineHeight: 1.4, whiteSpace: 'pre-line' }}>
          {data.spec}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { energy: EnergyNode }

const mkEdge = (id, source, target, label, color, opts = {}) => ({
  id, source, target, label,
  style: {
    stroke: color,
    strokeWidth: opts.width || 2,
    ...(opts.dashed ? { strokeDasharray: '5 3' } : {}),
  },
  markerEnd: { type: MarkerType.ArrowClosed, color },
  labelStyle: { fontSize: 10, fill: color },
  labelBgStyle: { fill: opts.labelBg || '#fff', fillOpacity: 0.88 },
  ...(opts.sourceHandle ? { sourceHandle: opts.sourceHandle } : {}),
  ...(opts.targetHandle ? { targetHandle: opts.targetHandle } : {}),
  type: 'smoothstep',
})

function buildGraph(design, simState, selectedPanel, selectedInverter, selectedBattery) {
  if (!design) return { nodes: [], edges: [] }

  const prof     = design.profile
  const panel    = selectedPanel    || design.panels?.[0]
  const inv      = selectedInverter || design.inverters?.[0]
  const bat      = selectedBattery  || design.batteries?.[0]
  const isOnGrid = prof?.grid_scenario !== 'off_grid'

  const LOAD_EXAMPLES = {
    residential: { critical: 'Fridge, lighting, router, essential AC',    shiftable: 'Laundry, water heater, secondary cooling' },
    farm:        { critical: 'Irrigation controller, water pumps',          shiftable: 'Secondary pumping, non-urgent equipment' },
    facility:    { critical: 'Servers, safety systems, core production',    shiftable: 'HVAC, compressors, non-critical lines' },
  }
  const loadEx = LOAD_EXAMPLES[prof?.user_type] || LOAD_EXAMPLES.facility

  const pvKw = simState?.pv_output_kw ?? 0
  const gKw  = simState?.grid_kw ?? 0
  const bKw  = simState?.battery_discharge_kw ?? 0
  const lKw  = simState?.load_kw ?? 0
  const ew   = (kw, base = 2) => Math.min(5, base + Math.round(kw / 60))

  /*
   * Node grid (3 columns × 3 rows, node ~150×80px):
   *
   *   Col A x=60    Col B x=290    Col C x=520
   *   PV [0,0]      Inverter [1,0] Critical [2,0]   y=60
   *   Battery [0,1] Controller[1,1]Shiftable[2,1]   y=240
   *   Grid [0,2]                                     y=420
   *
   * All horizontal edges: right handle → left handle (same row)
   * All vertical edges:   bottom handle → top handle (same col, going up)
   *                     or top handle → bottom handle (going down)
   *
   * Grid is directly below Battery in the same column (Col A).
   * Controller is directly below Inverter in the same column (Col B).
   * So Grid↔Controller need a smoothstep routed path between columns —
   * we use bottom of Controller → top of Grid for backup supply,
   * keeping the route in Col A.
   */

  const nodes = [
    {
      id: 'pv', type: 'energy', position: { x: 60, y: 60 },
      data: { category: 'PV Array', label: panel ? `${panel.actual_kwp} kWp` : 'Solar panels',
        spec: panel ? `${panel.brand} ${panel.model}` : '', theme: 'pv' },
    },
    {
      id: 'inv', type: 'energy', position: { x: 290, y: 60 },
      data: { category: 'Inverter', label: inv ? inv.brand : 'Inverter',
        spec: inv ? `${inv.model}\n${inv.actual_kw ?? inv.capacity_kw} kW` : '', theme: 'inverter' },
    },
    {
      id: 'bat', type: 'energy', position: { x: 20, y: 240 },
      data: { category: 'Battery', label: bat ? bat.brand : 'Battery',
        spec: bat ? `${bat.model}\n${bat.actual_kwh ?? bat.capacity_kwh} kWh` : '', theme: 'battery' },
    },
    {
      id: 'ctrl', type: 'energy', position: { x: 290, y: 240 },
      data: { category: 'Smart Controller', label: 'Switching brain', spec: '7-mode rule engine', theme: 'controller' },
    },
    {
      id: 'crit', type: 'energy', position: { x: 520, y: 60 },
      data: { category: 'Critical loads', label: `${prof?.critical_load_pct ?? 30}% of load`, spec: loadEx.critical, theme: 'load' },
    },
    {
      id: 'shift', type: 'energy', position: { x: 520, y: 240 },
      data: { category: 'Shiftable loads', label: '~25% of load', spec: loadEx.shiftable, theme: 'load' },
    },
  ]

  if (isOnGrid) {
    // Grid is in Col A (same x as PV and Battery), below Battery
    nodes.push({
      id: 'grid', type: 'energy', position: { x: 60, y: 420 },
      data: { category: 'Utility grid', label: 'SEC grid', spec: 'Backup + net metering', theme: 'grid' },
    })
  }

  const edges = [
    // PV →right→ Inverter  (Row 0, horizontal)
    mkEdge('pv-inv',     'pv',   'inv',   'DC power',         '#BA7517', { width: ew(pvKw), labelBg: '#FAEEDA', sourceHandle: 'right', targetHandle: 'left' }),
    // Inverter →bottom→ Controller  (Col B, vertical)
    mkEdge('inv-ctrl',   'inv',  'ctrl',  'AC bus',           '#1D9E75', { sourceHandle: 'bottom', targetHandle: 'top' }),
    // Battery →right→ Controller  (Row 1, horizontal)
    mkEdge('bat-ctrl',   'bat',  'ctrl',  'Charge / Discharge', '#185FA5', { width: ew(bKw), labelBg: '#E6F1FB', sourceHandle: 'right', targetHandle: 'left' }),
    // Inverter →left→ Battery charge path  (dashed, routed from inv left to bat top)
    mkEdge('inv-bat',    'inv',  'bat',   'Charge',            '#1D9E75', { dashed: true, sourceHandle: 'left', targetHandle: 'top' }),
    // Controller →right→ Critical loads  (Row 1→0, same row as ctrl)
    mkEdge('ctrl-crit',  'ctrl', 'crit',  'Always on',         '#534AB7', { width: ew(lKw * 0.3),  labelBg: '#F3F0FF', sourceHandle: 'right', targetHandle: 'left' }),
    // Controller →right→ Shiftable loads  (Row 1, horizontal)
    mkEdge('ctrl-shift', 'ctrl', 'shift', 'Dispatch',          '#534AB7', { width: ew(lKw * 0.25), labelBg: '#F3F0FF', sourceHandle: 'right', targetHandle: 'left' }),
  ]

  if (isOnGrid) {
    // Grid (Col A row 2) → Controller (Col B row 1):
    // Use right handle of Grid → bottom handle of Controller.
    // smoothstep will route a clean L-shape going right then up.
    edges.push(mkEdge('grid-ctrl', 'grid', 'ctrl', 'Backup supply', '#9CA3AF',
      { width: ew(gKw), labelBg: '#F3F4F6', sourceHandle: 'right', targetHandle: 'bottom' }))

    // Controller (Col B row 1) → Grid (Col A row 2):
    // Dashed net-metering return, bottom of ctrl → top of grid.
    // Both handles are on adjacent vertical nodes — smoothstep routes cleanly.
    edges.push(mkEdge('ctrl-grid', 'ctrl', 'grid', 'Net metering', '#9CA3AF',
      { dashed: true, labelBg: '#F3F4F6', sourceHandle: 'bottom', targetHandle: 'top' }))
  }

  return { nodes, edges }
}

export default function SystemDiagram() {
  const {
    systemDesign, simState,
    selectedPanel, selectedInverter, selectedBattery,
  } = useApp()

  const { nodes, edges } = useMemo(
    () => buildGraph(systemDesign, simState, selectedPanel, selectedInverter, selectedBattery),
    [systemDesign, simState, selectedPanel, selectedInverter, selectedBattery]
  )

  if (!systemDesign) return null

  return (
    <div style={{ height: 540, borderRadius: 10, overflow: 'hidden', border: '0.5px solid #D1D5DB', background: '#fafafa' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18 }}
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