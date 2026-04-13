/**
 * api.js
 * All communication with the FastAPI backend lives here.
 * Import these functions anywhere in the frontend.
 */

import axios from 'axios'

const BASE = 'http://localhost:8000'

const api = axios.create({ baseURL: BASE })

// ── Layer 1 ───────────────────────────────────────────────────────────────

/** Submit facility profile → get full system design back */
export async function submitDesign(profile) {
  const res = await api.post('/design', profile)
  return res.data  // { status, system_design }
}

/** Get the current system design (after page refresh) */
export async function getCurrentDesign() {
  const res = await api.get('/design/current')
  return res.data
}

/** Get the raw component database */
export async function getComponents() {
  const res = await api.get('/components')
  return res.data
}

// ── Layer 2 ───────────────────────────────────────────────────────────────

/** Advance simulation one step — call on a timer every 3 seconds */
export async function getNextStep() {
  const res = await api.get('/simulate/next')
  return res.data  // { status, state }
}

/** Get last N rows for the 24h history chart */
export async function getHistory(lastN = 96) {
  const res = await api.get(`/simulate/history?last_n=${lastN}`)
  return res.data  // { status, history: [...] }
}

/** Get running KPI totals */
export async function getSummary() {
  const res = await api.get('/simulate/summary')
  return res.data  // { status, summary }
}

/** Inject a scenario event */
export async function injectScenario(scenario, value = null) {
  const res = await api.post('/simulate/scenario', { scenario, value })
  return res.data
}

/** Set simulation speed */
export async function setSpeed(speed) {
  const res = await api.post('/simulate/speed', { speed })
  return res.data
}

/** Reset simulation to start */
export async function resetSimulation() {
  const res = await api.post('/simulate/reset')
  return res.data
}

/** Health check */
export async function healthCheck() {
  const res = await api.get('/health')
  return res.data
}