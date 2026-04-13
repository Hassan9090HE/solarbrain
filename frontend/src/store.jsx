/**
 * store.jsx
 * Shared application state using React Context.
 * Wrap the whole app in <AppProvider> and use useApp() anywhere.
 *
 * KEY ADDITION: finalDesignSnapshot
 *   A frozen snapshot set ONLY when the user clicks "Generate Final Design".
 *   Stage B of Layer 1 reads exclusively from this snapshot.
 *   It survives navigation (Layer 1 → Layer 2 → Layer 1) because it lives in the store.
 *   It is never recomputed reactively — only updated deliberately on user action.
 *   This is what permanently fixes the Layer 1 chart disappearing bug.
 */

import { createContext, useContext, useState, useCallback } from 'react'

const AppContext = createContext(null)

export const DEFAULT_FORM = {
  user_type: 'facility', region: 'eastern', grid_scenario: 'on_grid',
  monthly_bill_sar: 15000, peak_load_kw: 150, operating_hours: 14,
  critical_load_pct: 20, pump_power_kw: '', pump_hours_day: 8,
  ac_units: '', building_size_m2: '', roof_area_m2: '',
  has_generator: false, generator_kva: '',
}

export function AppProvider({ children }) {

  // ── Layer 1 state ──────────────────────────────────────────────────────
  const [systemDesign, setSystemDesign]       = useState(null)
  const [selectedPanel,   setSelectedPanel]   = useState(null)
  const [selectedInverter,setSelectedInverter]= useState(null)
  const [selectedBattery, setSelectedBattery] = useState(null)
  const [designLoading, setDesignLoading]     = useState(false)
  const [designError,   setDesignError]       = useState(null)
  const [formValues, setFormValues]           = useState(DEFAULT_FORM)

  /**
   * finalDesignSnapshot — the heart of the fix.
   *
   * Shape: {
   *   financials,          // computed financials for the selected combination
   *   capexBreakdown,      // { panelCost, invCost, batCost, protectionSar, bosSar, total }
   *   panel,               // frozen selected panel object
   *   inverter,            // frozen selected inverter object
   *   battery,             // frozen selected battery object
   *   systemProfile,       // frozen profile from systemDesign.profile
   *   demandSavings,       // null | { peak_reduction_kw, annual_demand_saving_sar, ... }
   *   co2,                 // null | { yr1_co2_tonnes, yr10_co2_tonnes, trees_equivalent }
   *   userType,            // 'facility' | 'farm' | 'residential'
   * }
   *
   * Set to null initially. Set once on first Generate Final. Never cleared on navigation.
   */
  const [finalDesignSnapshot, setFinalDesignSnapshot] = useState(null)

  // ── Layer 2 state ──────────────────────────────────────────────────────
  const [simState,   setSimState]   = useState(null)
  const [simHistory, setSimHistory] = useState([])
  const [simRunning, setSimRunning] = useState(false)
  const [simPaused,  setSimPaused]  = useState(false)
  const [simSpeed,   setSimSpeed]   = useState(1)

  // ── Navigation ─────────────────────────────────────────────────────────
  const [view, setView] = useState('design')

  const goToSimulation = useCallback(() => setView('simulation'), [])
  const goToDesign     = useCallback(() => setView('design'),     [])

  const applyDefaultSelections = useCallback((design) => {
    if (design?.panels?.[0])    setSelectedPanel(design.panels[0])
    if (design?.inverters?.[0]) setSelectedInverter(design.inverters[0])
    if (design?.batteries?.[0]) setSelectedBattery(design.batteries[0])
  }, [])

  const pushHistory = useCallback((state) => {
    setSimHistory(prev => {
      const next = [...prev, state]
      return next.length > 288 ? next.slice(-288) : next
    })
  }, [])

  return (
    <AppContext.Provider value={{
      // Layer 1
      systemDesign, setSystemDesign,
      selectedPanel, setSelectedPanel,
      selectedInverter, setSelectedInverter,
      selectedBattery, setSelectedBattery,
      designLoading, setDesignLoading,
      designError, setDesignError,
      formValues, setFormValues,
      applyDefaultSelections,

      // Final design snapshot — the stable source of truth for Stage B
      finalDesignSnapshot, setFinalDesignSnapshot,

      // Layer 2
      simState, setSimState,
      simHistory, setSimHistory, pushHistory,
      simRunning, setSimRunning,
      simPaused, setSimPaused,
      simSpeed, setSimSpeed,

      // Navigation
      view, setView, goToSimulation, goToDesign,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}