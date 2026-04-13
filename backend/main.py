"""
main.py
FastAPI server for SolarBrain.
Wraps sizing_engine, dataset_generator, and brain into a REST API.

Run with:
    uvicorn backend.main:app --reload --port 8000
Or from the backend folder:
    uvicorn main:app --reload --port 8000
"""

import os
import json
import sys
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

# ── Path setup so imports work when running from project root ────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from sizing_engine      import size_system
from dataset_generator  import generate_dataset
from brain              import SimulationRunner


# ══════════════════════════════════════════════════════════════════════════════
# App setup
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="SolarBrain API",
    description="Intelligent Hybrid Energy Management System — Backend",
    version="1.0.0"
)

# Allow React frontend (any localhost port) to call this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # tighten this for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory state ──────────────────────────────────────────────────────────
# One runner per session — replaced every time /design is called
_runner: Optional[SimulationRunner] = None
_system_design: Optional[dict]       = None

DATA_DIR    = os.path.join(BASE_DIR, "..", "data")
DATASET_PATH = os.path.join(DATA_DIR, "simulation.csv")


# ══════════════════════════════════════════════════════════════════════════════
# Request / Response models
# ══════════════════════════════════════════════════════════════════════════════

class FacilityProfile(BaseModel):
    """
    User input from the Layer 1 form.
    All fields match what the React form will POST.
    """
    user_type:          str             # "facility" | "farm" | "residential"
    region:             str             # "eastern" | "central" | "western"
    grid_scenario:      str             # "on_grid" | "off_grid"
    monthly_bill_sar:   float

    # Optional — derived if missing
    peak_load_kw:       Optional[float] = None
    operating_hours:    Optional[float] = 10
    building_size_m2:   Optional[float] = None
    critical_load_pct:  Optional[float] = 30
    roof_area_m2:       Optional[float] = None

    # Farm specific
    pump_power_kw:      Optional[float] = None
    pump_hours_day:     Optional[float] = 8

    # Residential specific
    ac_units:           Optional[int]   = None

    # Off-grid
    has_generator:      Optional[bool]  = False
    generator_kva:      Optional[float] = 0


class ScenarioRequest(BaseModel):
    """Scenario injection payload."""
    scenario: str            # see brain.inject_scenario() for valid values
    value:    Optional[float] = None


class SpeedRequest(BaseModel):
    """Simulation speed control."""
    speed: int               # 1 = normal, 5 = fast, 10 = superfast


# ══════════════════════════════════════════════════════════════════════════════
# Endpoints
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
def health():
    """Confirm server is alive."""
    return {
        "status":      "ok",
        "version":     "1.0.0",
        "runner_ready":_runner is not None
    }


@app.post("/design")
def design(profile: FacilityProfile):
    """
    Layer 1 endpoint.
    Accepts user profile, runs sizing engine, generates dataset,
    initialises the simulation runner.
    Returns full system design including component recommendations
    and financial model.
    """
    global _runner, _system_design

    # Convert Pydantic model to plain dict
    profile_dict = profile.model_dump()

    # 1 — Run sizing engine
    try:
        system_design = size_system(profile_dict)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sizing engine error: {str(e)}")

    # 2 — Generate dataset shaped to this facility
    try:
        sim_cfg = system_design["simulation_config"]
        generate_dataset(sim_cfg, output_path=DATASET_PATH)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Dataset generation error: {str(e)}")

    # 3 — Initialise simulation runner
    try:
        _runner        = SimulationRunner(system_design, DATASET_PATH)
        _system_design = system_design
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Runner init error: {str(e)}")

    # 4 — Return design (strip yearly_data list to keep response small)
    response = dict(system_design)
    if "financials" in response and "yearly_data" in response["financials"]:
        # Keep milestones, remove the full 10-year list from the main response
        # Frontend can fetch it separately if needed
        pass   # we keep it — it is needed for the ROI chart

    return {
        "status":        "ok",
        "system_design": response
    }


@app.get("/simulate/next")
def simulate_next():
    """
    Advance the simulation one step (or `speed` steps).
    Returns the current brain state — call this repeatedly from the frontend
    on a timer (every 3 seconds) to drive the live dashboard.
    """
    if _runner is None:
        raise HTTPException(status_code=400, detail="No simulation running. Call /design first.")

    state = _runner.next_step()

    if state is None:
        return {"status": "complete", "message": "Simulation reached end of dataset"}

    return {"status": "ok", "state": state}


@app.get("/simulate/history")
def simulate_history(last_n: int = 96):
    """
    Return the last N simulated states for the 24h history chart.
    Default 96 = 24 hours at 15-min intervals.
    """
    if _runner is None:
        raise HTTPException(status_code=400, detail="No simulation running.")

    history = _runner.get_history(last_n)
    return {"status": "ok", "history": history}


@app.get("/simulate/summary")
def simulate_summary():
    """Return running KPI totals — used to populate the cumulative summary panel."""
    if _runner is None:
        raise HTTPException(status_code=400, detail="No simulation running.")

    return {"status": "ok", "summary": _runner.get_summary()}


@app.post("/simulate/scenario")
def simulate_scenario(req: ScenarioRequest):
    """
    Inject a scenario event into the running simulation.
    Valid scenarios:
        grid_outage, grid_restore,
        season_summer, season_moderate, season_winter, season_reset,
        load_spike, load_restore,
        cloud_cover, cloud_restore,
        low_battery
    """
    if _runner is None:
        raise HTTPException(status_code=400, detail="No simulation running.")

    valid = {
        "grid_outage", "grid_restore",
        "season_summer", "season_moderate", "season_winter", "season_reset",
        "load_spike", "load_restore",
        "cloud_cover", "cloud_restore",
        "low_battery", "low_battery_restore"
    }
    if req.scenario not in valid:
        raise HTTPException(status_code=400, detail=f"Unknown scenario: {req.scenario}")

    _runner.inject_scenario(req.scenario, req.value)

    return {
        "status":   "ok",
        "scenario": req.scenario,
        "message":  f"Scenario '{req.scenario}' injected successfully"
    }


@app.post("/simulate/speed")
def simulate_speed(req: SpeedRequest):
    """Set simulation speed. 1=normal, 5=fast, 10=superfast."""
    if _runner is None:
        raise HTTPException(status_code=400, detail="No simulation running.")

    _runner.set_speed(req.speed)
    return {"status": "ok", "speed": req.speed}


@app.post("/simulate/reset")
def simulate_reset():
    """Reset the simulation to the beginning with the same system design."""
    if _runner is None:
        raise HTTPException(status_code=400, detail="No simulation running.")

    _runner.reset()
    return {"status": "ok", "message": "Simulation reset to start"}


@app.get("/design/current")
def get_current_design():
    """Return the current system design — used when frontend refreshes."""
    if _system_design is None:
        raise HTTPException(status_code=404, detail="No design loaded yet.")
    return {"status": "ok", "system_design": _system_design}


@app.get("/components")
def get_components():
    """Return the full component database — used to display all options in UI."""
    try:
        comp_path = os.path.join(DATA_DIR, "components.json")
        with open(comp_path) as f:
            components = json.load(f)
        return {"status": "ok", "components": components}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="components.json not found")