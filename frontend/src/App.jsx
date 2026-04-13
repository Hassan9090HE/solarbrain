/**
 * App.jsx
 * Root component. Switches between DesignView (Layer 1)
 * and SimulationView (Layer 2) based on app state.
 */

import { AppProvider, useApp } from "./store.jsx";
import DesignView     from './views/DesignView'
import SimulationView from './views/SimulationView'

function AppContent() {
  const { view } = useApp()
  return view === 'design' ? <DesignView /> : <SimulationView />
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  )
}