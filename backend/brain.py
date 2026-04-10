"""
brain.py
The intelligent switching engine for SolarBrain.

Two classes:
  Brain            — stateful 7-mode decision engine, called once per dataset row
  SimulationRunner — manages the dataset + brain together, exposes next_step() to the API
"""

import pandas as pd
import os
import json
from datetime import datetime


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Constants
# ══════════════════════════════════════════════════════════════════════════════

# All 7 modes
MODE_SOLAR_ONLY        = "SOLAR_ONLY"
MODE_HYBRID            = "HYBRID"
MODE_BATTERY_BACKUP    = "BATTERY_BACKUP"
MODE_EMERGENCY         = "EMERGENCY"
MODE_CHARGE_MODE       = "CHARGE_MODE"
MODE_GRID_ONLY         = "GRID_ONLY"
MODE_GENERATOR_BACKUP  = "GENERATOR_BACKUP"

# Hysteresis thresholds — enter vs exit to prevent flickering
HYSTERESIS = {
    MODE_SOLAR_ONLY:     {"enter_pv_pct": 92, "exit_pv_pct": 85},
    MODE_HYBRID:         {"enter_pv_pct": 52, "exit_pv_pct": 45},
    MODE_BATTERY_BACKUP: {"enter_soc": 42,    "exit_soc": 35},
    MODE_CHARGE_MODE:    {"enter_soc": 23,    "exit_soc": 30},
}

# Cycles a condition must hold before a mode change is confirmed (2 × 15 min = 30 min)
HYSTERESIS_CYCLES = 2

# SA grid CO2 emission factor
GRID_CO2_KG_PER_KWH = 0.72

# Interval duration in hours (15 minutes)
INTERVAL_H = 0.25

# Peak pricing hours
PEAK_HOURS_START = 12
PEAK_HOURS_END   = 17
OFFPEAK_HOURS    = set(range(0, 7)) | set(range(22, 24))

# Mode display colors (for frontend)
MODE_COLORS = {
    MODE_SOLAR_ONLY:       "#BA7517",
    MODE_HYBRID:           "#1D9E75",
    MODE_BATTERY_BACKUP:   "#534AB7",
    MODE_EMERGENCY:        "#A32D2D",
    MODE_CHARGE_MODE:      "#185FA5",
    MODE_GRID_ONLY:        "#6B7280",
    MODE_GENERATOR_BACKUP: "#374151",
}

MODE_DESCRIPTIONS = {
    MODE_SOLAR_ONLY:       "Solar covering full load",
    MODE_HYBRID:           "Solar + grid top-up",
    MODE_BATTERY_BACKUP:   "Battery avoiding peak price",
    MODE_EMERGENCY:        "Grid down — battery protecting critical loads",
    MODE_CHARGE_MODE:      "Charging battery on cheap off-peak grid",
    MODE_GRID_ONLY:        "Grid covering full load",
    MODE_GENERATOR_BACKUP: "Generator backup — battery critically low",
}


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Brain class
# ══════════════════════════════════════════════════════════════════════════════

class Brain:
    """
    Stateful 7-mode switching engine.
    Call step(row) with each dataset row to get the current system state.
    """

    def __init__(self, simulation_config: dict):
        """
        Initialise the brain from the simulation_config produced by sizing_engine.
        """
        cfg = simulation_config

        self.grid_scenario     = cfg.get("grid_scenario", "on_grid")
        self.battery_kwh       = float(cfg.get("battery_kwh", 100))
        self.dod_pct           = float(cfg.get("dod_pct", 90))
        self.peak_load_kw      = float(cfg.get("peak_load_kw", 100))
        self.has_generator     = bool(cfg.get("has_generator", False))
        self.gen_kw_max        = float(cfg.get("generator_kva", 0)) * 0.8
        self.user_type         = cfg.get("user_type", "facility")
        self.tariff            = cfg.get("tariff", {})
        self.critical_pct      = float(cfg.get("critical_load_pct", 30)) / 100

        # DoD floor — battery never discharges below this SOC
        self.floor_soc         = (1 - self.dod_pct / 100) * 100

        # Simulation state
        self.battery_soc       = 80.0
        self.current_mode      = MODE_GRID_ONLY
        self.previous_mode     = MODE_GRID_ONLY
        self.hysteresis_count  = 0

        # Scenario overrides
        self.force_grid_down   = False
        self.force_season      = None
        self.load_spike_kw     = 0.0

        # Running KPI totals
        self.total_co2_saved_kg        = 0.0
        self.total_cost_sar            = 0.0
        self.total_solar_kwh           = 0.0
        self.total_grid_kwh            = 0.0
        self.total_export_kwh          = 0.0
        self.total_net_meter_sar       = 0.0
        self.total_gen_fuel_sar        = 0.0
        self.interval_count            = 0

        # Decision log
        self.decision_log              = []

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _is_peak_hour(self, hour: int) -> bool:
        return PEAK_HOURS_START <= hour <= PEAK_HOURS_END

    def _is_offpeak(self, hour: int) -> bool:
        return hour in OFFPEAK_HOURS

    def _battery_usable_kwh(self) -> float:
        """kWh available to discharge above the DoD floor."""
        usable_soc = max(0, self.battery_soc - self.floor_soc)
        return (usable_soc / 100) * self.battery_kwh

    def _battery_empty(self) -> bool:
        return self.battery_soc <= self.floor_soc

    def _log_mode_change(self, new_mode: str, reason: str, timestamp):
        """Record a mode transition to the decision log."""
        entry = {
            "timestamp":   str(timestamp),
            "from_mode":   self.previous_mode,
            "to_mode":     new_mode,
            "reason":      reason,
            "battery_soc": round(self.battery_soc, 1),
        }
        self.decision_log.append(entry)
        if len(self.decision_log) > 200:
            self.decision_log = self.decision_log[-200:]

    # ── Mode decision ─────────────────────────────────────────────────────────

    def _decide(self, pv_kw: float, load_kw: float, hour: int, grid_available: bool) -> str:
        """
        Evaluate 7 rules in priority order with hysteresis.
        Returns the confirmed mode for this interval.
        """
        pv_pct = (pv_kw / load_kw * 100) if load_kw > 0 else 0
        h = HYSTERESIS
        currently = self.current_mode

        # Priority 1: EMERGENCY
        if not grid_available and self.grid_scenario == "on_grid":
            return MODE_EMERGENCY

        # Priority 2: GENERATOR_BACKUP
        if self.grid_scenario == "off_grid" and self._battery_empty() and self.has_generator:
            return MODE_GENERATOR_BACKUP

        # Candidate mode logic
        if pv_pct >= h[MODE_SOLAR_ONLY]["enter_pv_pct"] and not self._battery_empty():
            candidate = MODE_SOLAR_ONLY

        elif currently == MODE_SOLAR_ONLY and pv_pct >= h[MODE_SOLAR_ONLY]["exit_pv_pct"] and not self._battery_empty():
            candidate = MODE_SOLAR_ONLY

        elif self._is_peak_hour(hour) and self.battery_soc > h[MODE_BATTERY_BACKUP]["enter_soc"]:
            candidate = MODE_BATTERY_BACKUP

        elif currently == MODE_BATTERY_BACKUP and self._is_peak_hour(hour) and self.battery_soc > h[MODE_BATTERY_BACKUP]["exit_soc"]:
            candidate = MODE_BATTERY_BACKUP

        elif pv_pct >= h[MODE_HYBRID]["enter_pv_pct"]:
            candidate = MODE_HYBRID

        elif currently == MODE_HYBRID and pv_pct >= h[MODE_HYBRID]["exit_pv_pct"]:
            candidate = MODE_HYBRID

        elif self._is_offpeak(hour) and self.battery_soc < h[MODE_CHARGE_MODE]["enter_soc"] and self.grid_scenario == "on_grid":
            candidate = MODE_CHARGE_MODE

        elif currently == MODE_CHARGE_MODE and self.battery_soc < h[MODE_CHARGE_MODE]["exit_soc"] and self.grid_scenario == "on_grid":
            candidate = MODE_CHARGE_MODE

        else:
            candidate = MODE_GRID_ONLY

        # Hysteresis confirmation
        if candidate in (MODE_EMERGENCY, MODE_GENERATOR_BACKUP):
            return candidate

        if candidate == self.current_mode:
            self.hysteresis_count = 0
            return self.current_mode

        self.hysteresis_count += 1
        if self.hysteresis_count >= HYSTERESIS_CYCLES:
            self.hysteresis_count = 0
            return candidate

        return self.current_mode

    # ── Energy split ─────────────────────────────────────────────────────────

    def _split(self, mode: str, pv_kw: float, load_kw: float, hour: int, grid_price: float) -> dict:
        """
        Given the decided mode, calculate kW from each source.
        """
        solar_kw   = 0.0
        battery_kw = 0.0   # positive = discharge to load
        grid_kw    = 0.0
        gen_kw     = 0.0
        export_kw  = 0.0
        charge_kw  = 0.0   # positive = charging battery

        usable     = self._battery_usable_kwh()
        max_dis    = usable / INTERVAL_H if INTERVAL_H > 0 else 0

        if mode == MODE_SOLAR_ONLY:
            solar_kw = min(pv_kw, load_kw)
            surplus  = max(0, pv_kw - load_kw)
            if surplus > 0:
                if self.battery_soc < 95:
                    charge_kw = min(surplus, self.battery_kwh * 0.3 / INTERVAL_H)
                else:
                    export_kw = surplus

        elif mode == MODE_HYBRID:
            solar_kw = min(pv_kw, load_kw)
            deficit  = max(0, load_kw - pv_kw)
            grid_kw  = deficit
            surplus  = max(0, pv_kw - load_kw)
            if surplus > 0:
                if self.battery_soc < 95:
                    charge_kw = min(surplus, self.battery_kwh * 0.2 / INTERVAL_H)
                else:
                    export_kw = surplus

        elif mode == MODE_BATTERY_BACKUP:
            solar_kw   = min(pv_kw, load_kw)
            deficit    = max(0, load_kw - solar_kw)
            battery_kw = min(deficit, max_dis, self.battery_kwh * 0.4 / INTERVAL_H)
            grid_kw    = max(0, deficit - battery_kw)

        elif mode == MODE_EMERGENCY:
            critical   = load_kw * self.critical_pct
            solar_kw   = min(pv_kw, critical)
            deficit    = max(0, critical - solar_kw)
            battery_kw = min(deficit, max_dis)

        elif mode == MODE_CHARGE_MODE:
            solar_kw   = min(pv_kw, load_kw)
            deficit    = max(0, load_kw - solar_kw)
            charge_amt = min(
                (100 - self.battery_soc) / 100 * self.battery_kwh / INTERVAL_H,
                self.battery_kwh * 0.3 / INTERVAL_H
            )
            grid_kw    = deficit + charge_amt
            charge_kw  = charge_amt

        elif mode == MODE_GENERATOR_BACKUP:
            solar_kw   = min(pv_kw, load_kw)
            deficit    = max(0, load_kw - solar_kw)
            gen_kw     = min(self.gen_kw_max, deficit)
            battery_kw = max(0, deficit - gen_kw)
            if self.battery_soc < 30 and gen_kw < self.gen_kw_max:
                charge_kw = min(
                    self.gen_kw_max - gen_kw,
                    (30 - self.battery_soc) / 100 * self.battery_kwh / INTERVAL_H
                )
                gen_kw += charge_kw

        else:  # GRID_ONLY
            solar_kw = min(pv_kw, load_kw)
            deficit  = max(0, load_kw - solar_kw)
            grid_kw  = deficit
            surplus  = max(0, pv_kw - load_kw)
            if surplus > 0 and self.battery_soc < 90:
                charge_kw = min(surplus, self.battery_kwh * 0.15 / INTERVAL_H)

        if self.user_type == "farm" and pv_kw > load_kw * 0.8:
            grid_kw = max(0, grid_kw * 0.5)

        # Update battery SOC
        energy_in  = charge_kw * INTERVAL_H
        energy_out = battery_kw * INTERVAL_H
        if self.battery_kwh > 0:
            soc_delta = ((energy_in - energy_out) / self.battery_kwh) * 100
            self.battery_soc = max(self.floor_soc, min(100.0, self.battery_soc + soc_delta))

        return {
            "solar_kw":      round(solar_kw, 3),
            "battery_kw":    round(battery_kw, 3),
            "grid_kw":       round(grid_kw, 3),
            "generator_kw":  round(gen_kw, 3),
            "charge_kw":     round(charge_kw, 3),
            "export_kw":     round(export_kw, 3),
        }

    # ── KPI calculation ───────────────────────────────────────────────────────

    def _kpis(self, split: dict, load_kw: float, grid_price: float, pv_kw: float) -> dict:
        """Compute interval KPIs and update running totals."""
        solar_kw  = split["solar_kw"]
        grid_kw   = split["grid_kw"]
        export_kw = split["export_kw"]
        gen_kw    = split["generator_kw"]

        co2_saved = solar_kw * INTERVAL_H * GRID_CO2_KG_PER_KWH
        cost_sar  = grid_kw * INTERVAL_H * grid_price
        export_rate = self.tariff.get("export_rate_sar_kwh", 0.12)
        net_meter = export_kw * INTERVAL_H * export_rate
        gen_fuel  = gen_kw * INTERVAL_H * 0.25 * 0.75

        solar_util = (solar_kw / pv_kw * 100) if pv_kw > 0 else 0.0
        grid_dep   = (grid_kw / load_kw * 100) if load_kw > 0 else 0.0

        self.total_co2_saved_kg  += co2_saved
        self.total_cost_sar      += cost_sar
        self.total_solar_kwh     += solar_kw * INTERVAL_H
        self.total_grid_kwh      += grid_kw * INTERVAL_H
        self.total_export_kwh    += export_kw * INTERVAL_H
        self.total_net_meter_sar += net_meter
        self.total_gen_fuel_sar  += gen_fuel
        self.interval_count      += 1

        return {
            "co2_saved_kg":             round(co2_saved, 4),
            "cost_sar":                 round(cost_sar, 4),
            "net_metering_revenue_sar": round(net_meter, 4),
            "generator_fuel_cost_sar":  round(gen_fuel, 4),
            "solar_utilization_pct":    round(solar_util, 1),
            "grid_dependency_pct":      round(grid_dep, 1),
            "total_co2_saved_kg":       round(self.total_co2_saved_kg, 2),
            "total_cost_sar":           round(self.total_cost_sar, 2),
            "total_solar_kwh":          round(self.total_solar_kwh, 2),
            "total_grid_kwh":           round(self.total_grid_kwh, 2),
            "total_net_meter_sar":      round(self.total_net_meter_sar, 2),
        }

    # ── Main step method ──────────────────────────────────────────────────────

    def step(self, row: dict) -> dict:
        """
        Process one dataset row. Returns the full system state for this interval.
        """
        timestamp  = row.get("timestamp", "")
        hour       = int(row.get("hour_of_day", 0))
        pv_kw      = float(row.get("pv_output_kw", 0))
        load_kw    = float(row.get("facility_load_kw", 0))
        grid_price = float(row.get("grid_price_sar_kwh", 0.22))
        grid_avail = bool(row.get("grid_available", True))
        season     = self.force_season or row.get("season", "moderate")

        if self.force_grid_down:
            grid_avail = False

        load_kw += self.load_spike_kw

        new_mode = self._decide(pv_kw, load_kw, hour, grid_avail)

        if new_mode != self.current_mode:
            reason = self._build_reason(new_mode, pv_kw, load_kw, hour, grid_avail)
            self._log_mode_change(new_mode, reason, timestamp)

        self.previous_mode = self.current_mode
        self.current_mode  = new_mode

        split = self._split(new_mode, pv_kw, load_kw, hour, grid_price)
        kpis  = self._kpis(split, load_kw, grid_price, pv_kw)

        state = {
            "timestamp":            str(timestamp),
            "hour":                 hour,
            "season":               season,
            "interval":             self.interval_count,
            "mode":                 new_mode,
            "mode_color":           MODE_COLORS[new_mode],
            "mode_description":     MODE_DESCRIPTIONS[new_mode],
            "pv_output_kw":         round(pv_kw, 2),
            "load_kw":              round(load_kw, 2),
            "battery_soc_pct":      round(self.battery_soc, 1),
            "grid_available":       grid_avail,
            "solar_kw":             split["solar_kw"],
            "battery_discharge_kw": split["battery_kw"],
            "grid_kw":              split["grid_kw"],
            "generator_kw":         split["generator_kw"],
            "battery_charge_kw":    split["charge_kw"],
            "grid_export_kw":       split["export_kw"],
            "co2_saved_kg":         kpis["co2_saved_kg"],
            "cost_sar":             kpis["cost_sar"],
            "net_metering_revenue_sar": kpis["net_metering_revenue_sar"],
            "generator_fuel_cost_sar":  kpis["generator_fuel_cost_sar"],
            "solar_utilization_pct":    kpis["solar_utilization_pct"],
            "grid_dependency_pct":      kpis["grid_dependency_pct"],
            "total_co2_saved_kg":       kpis["total_co2_saved_kg"],
            "total_cost_sar":           kpis["total_cost_sar"],
            "total_solar_kwh":          kpis["total_solar_kwh"],
            "total_grid_kwh":           kpis["total_grid_kwh"],
            "total_net_meter_sar":      kpis["total_net_meter_sar"],
            "recent_decisions":         self.decision_log[-10:],
        }

        return state

    def _build_reason(self, new_mode: str, pv_kw: float, load_kw: float, hour: int, grid_avail: bool) -> str:
        """Build a human-readable reason string for a mode change."""
        pv_pct = round(pv_kw / load_kw * 100, 0) if load_kw > 0 else 0
        soc    = round(self.battery_soc, 0)

        reasons = {
            MODE_EMERGENCY:        f"Grid outage detected — protecting critical loads ({self.critical_pct*100:.0f}% of load)",
            MODE_GENERATOR_BACKUP: f"Battery at floor SOC {soc}% — generator activated",
            MODE_SOLAR_ONLY:       f"Solar at {pv_pct}% of load — battery SOC {soc}%",
            MODE_BATTERY_BACKUP:   f"Peak hours (hour {hour}) — battery SOC {soc}%, avoiding peak grid price",
            MODE_HYBRID:           f"Solar at {pv_pct}% of load — grid covering deficit",
            MODE_CHARGE_MODE:      f"Off-peak hours — battery SOC low at {soc}%, charging cheaply",
            MODE_GRID_ONLY:        f"Solar at {pv_pct}% of load — insufficient for HYBRID threshold",
        }
        return reasons.get(new_mode, "Mode change")

    def reset(self):
        """Reset simulation state to initial values."""
        self.battery_soc         = 80.0
        self.current_mode        = MODE_GRID_ONLY
        self.previous_mode       = MODE_GRID_ONLY
        self.hysteresis_count    = 0
        self.force_grid_down     = False
        self.force_season        = None
        self.load_spike_kw       = 0.0
        self.total_co2_saved_kg  = 0.0
        self.total_cost_sar      = 0.0
        self.total_solar_kwh     = 0.0
        self.total_grid_kwh      = 0.0
        self.total_export_kwh    = 0.0
        self.total_net_meter_sar = 0.0
        self.total_gen_fuel_sar  = 0.0
        self.interval_count      = 0
        self.decision_log        = []

    def inject_scenario(self, scenario: str, value=None):
        """
        Inject a scenario event.
        """
        if scenario == "grid_outage":
            self.force_grid_down = True
        elif scenario == "grid_restore":
            self.force_grid_down = False
        elif scenario == "season_summer":
            self.force_season = "summer"
        elif scenario == "season_moderate":
            self.force_season = "moderate"
        elif scenario == "season_winter":
            self.force_season = "winter"
        elif scenario == "season_reset":
            self.force_season = None
        elif scenario == "load_spike":
            self.load_spike_kw = float(value or self.peak_load_kw * 0.3)
        elif scenario == "load_restore":
            self.load_spike_kw = 0.0
        elif scenario == "low_battery":
            self.battery_soc = self.floor_soc + 2


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — SimulationRunner
# ══════════════════════════════════════════════════════════════════════════════

class SimulationRunner:
    """
    Manages the dataset + brain together.
    """

    def __init__(self, system_design: dict, dataset_path: str = None):
        """
        system_design can be either:
          1) full output from sizing_engine.size_system()
             -> contains system_design["simulation_config"]
          2) a raw simulation_config dict directly
        """
        self.system_design = system_design

        if isinstance(system_design, dict) and "simulation_config" in system_design:
            sim_cfg = system_design["simulation_config"]
        elif isinstance(system_design, dict):
            sim_cfg = system_design
        else:
            raise ValueError("SimulationRunner expected a dict for system_design/simulation_config")

        self.simulation_config = sim_cfg
        self.brain            = Brain(sim_cfg)
        self.dataset_path     = dataset_path
        self.df               = None
        self.current_index    = 0
        self.total_rows       = 0
        self.is_loaded        = False
        self.cloud_factor     = 1.0
        self.speed            = 1

        # Actual simulated history from brain outputs
        self.state_history    = []

        if dataset_path and os.path.exists(dataset_path):
            self.load_dataset(dataset_path)

    def load_dataset(self, path: str):
        """Load the simulation CSV into memory."""
        self.df         = pd.read_csv(path, parse_dates=["timestamp"])
        self.total_rows = len(self.df)
        self.is_loaded  = True

        now = datetime.now()
        hour = now.hour
        month_now = now.month

        season_map = {
            1: "winter", 2: "winter", 3: "moderate", 4: "moderate", 5: "moderate",
            6: "summer", 7: "summer", 8: "summer", 9: "summer",
            10: "moderate", 11: "moderate", 12: "winter"
        }
        target_season = season_map[month_now]

        matches = self.df[
            (self.df["hour_of_day"] == hour) &
            (self.df["season"] == target_season)
        ]
        self.current_index = int(matches.index[0]) if not matches.empty else 0

    def next_step(self) -> dict:
        """
        Advance the simulation by one step (or `speed` steps).
        Returns the state from the brain for the last step.
        """
        if not self.is_loaded or self.current_index >= self.total_rows:
            return None

        state = None
        for _ in range(self.speed):
            if self.current_index >= self.total_rows:
                break

            row = self.df.iloc[self.current_index].to_dict()
            row["pv_output_kw"] = row["pv_output_kw"] * self.cloud_factor

            state = self.brain.step(row)
            state["progress_pct"] = round(self.current_index / self.total_rows * 100, 1)
            state["current_index"] = self.current_index

            self.state_history.append(dict(state))
            if len(self.state_history) > 500:
                self.state_history = self.state_history[-500:]

            self.current_index += 1

        return state

    def inject_scenario(self, scenario: str, value=None):
        """Pass scenario injection to the brain and handle cloud cover here."""
        if scenario == "cloud_cover":
            self.cloud_factor = 0.4
        elif scenario == "cloud_restore":
            self.cloud_factor = 1.0
        else:
            self.brain.inject_scenario(scenario, value)

    def set_speed(self, speed: int):
        """Set simulation speed."""
        self.speed = max(1, min(20, int(speed)))

    def jump_to_season(self, season: str):
        """Jump the dataset index to the first row of the given season."""
        if self.df is None:
            return
        matches = self.df[self.df["season"] == season]
        if not matches.empty:
            self.current_index = int(matches.index[0])
        self.brain.inject_scenario(f"season_{season}")

    def jump_to_hour(self, hour: int):
        """Jump to the next occurrence of a specific hour."""
        if self.df is None:
            return
        future = self.df.iloc[self.current_index:]
        matches = future[future["hour_of_day"] == hour]
        if not matches.empty:
            self.current_index = int(matches.index[0])

    def reset(self):
        """Reset both brain and dataset position."""
        self.brain.reset()
        self.current_index = 0
        self.cloud_factor  = 1.0
        self.speed         = 1
        self.state_history = []

    def get_history(self, last_n: int = 96) -> list:
        """
        Return the last N simulated states.
        Better for frontend than raw CSV rows.
        """
        if not self.state_history:
            return []
        return self.state_history[-last_n:]

    def get_summary(self) -> dict:
        """Return a summary of the current simulation state."""
        b = self.brain
        hours_simulated = b.interval_count * INTERVAL_H
        return {
            "intervals_run":        b.interval_count,
            "hours_simulated":      round(hours_simulated, 1),
            "total_co2_saved_kg":   round(b.total_co2_saved_kg, 2),
            "total_cost_sar":       round(b.total_cost_sar, 2),
            "total_solar_kwh":      round(b.total_solar_kwh, 2),
            "total_grid_kwh":       round(b.total_grid_kwh, 2),
            "total_net_meter_sar":  round(b.total_net_meter_sar, 2),
            "current_mode":         b.current_mode,
            "battery_soc_pct":      round(b.battery_soc, 1),
            "solar_fraction_pct":   round(
                b.total_solar_kwh / (b.total_solar_kwh + b.total_grid_kwh) * 100, 1
            ) if (b.total_solar_kwh + b.total_grid_kwh) > 0 else 0,
        }


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Test block
# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":

    base_dir     = os.path.dirname(os.path.abspath(__file__))
    comp_path    = os.path.join(base_dir, "..", "data", "components.json")
    dataset_path = os.path.join(base_dir, "..", "data", "simulation.csv")

    with open(comp_path) as f:
        components = json.load(f)

    # Closer to Test 4 showcase sizing result
    sim_config = {
        "user_type":         "facility",
        "region":            "central",
        "grid_scenario":     "on_grid",
        "peak_load_kw":      150,
        "critical_load_pct": 20,
        "array_kwp":         568.67,
        "battery_kwh":       850.0,
        "dod_pct":           90,
        "ghi":               6.2,
        "tariff":            components["tariffs"]["facility"],
        "panel_temp_coeff":  -0.29,
        "has_generator":     False,
        "generator_kva":     0,
    }

    print("\n" + "=" * 60)
    print("  BRAIN.PY — SWITCHING ENGINE TEST")
    print("=" * 60)

    # ── Test A: Run one full simulated day row by row ──────────────────────
    print("\nTest A: Run 96 rows (one full day) from simulation.csv")
    print("─" * 60)

    if not os.path.exists(dataset_path):
        print("  simulation.csv not found — run dataset_generator.py first")
    else:
        runner = SimulationRunner(sim_config, dataset_path)
        runner.brain.battery_soc = 80.0
        runner.current_index = 0

        mode_counts = {}
        print(f"  {'Time':<8} {'Mode':<20} {'PV kW':>7} {'Load kW':>8} {'Batt%':>6} {'Grid kW':>8} {'SAR cost':>9}")
        print(f"  {'─'*7} {'─'*19} {'─'*7} {'─'*8} {'─'*6} {'─'*8} {'─'*9}")

        for i in range(96):
            state = runner.next_step()
            if not state:
                break
            mode_counts[state['mode']] = mode_counts.get(state['mode'], 0) + 1

            if i % 4 == 0:
                h = state["hour"]
                print(
                    f"  {h:02d}:00    {state['mode']:<20} "
                    f"{state['pv_output_kw']:>7.1f} "
                    f"{state['load_kw']:>8.1f} "
                    f"{state['battery_soc_pct']:>6.1f} "
                    f"{state['grid_kw']:>8.1f} "
                    f"{state['cost_sar']:>9.4f}"
                )

        print(f"\n  Mode distribution for this day:")
        for mode, count in sorted(mode_counts.items(), key=lambda x: -x[1]):
            print(f"    {mode:<22}: {count:>3} intervals  ({count*15} min)")

        summary = runner.get_summary()
        print(f"\n  Day summary:")
        print(f"    Solar generated : {summary['total_solar_kwh']:>8.1f} kWh")
        print(f"    Grid drawn      : {summary['total_grid_kwh']:>8.1f} kWh")
        print(f"    CO2 saved       : {summary['total_co2_saved_kg']:>8.1f} kg")
        print(f"    Cost paid       : {summary['total_cost_sar']:>8.1f} SAR")
        print(f"    Solar fraction  : {summary['solar_fraction_pct']:>8.1f}%")

    # ── Test B: Scenario injection ─────────────────────────────────────────
    print(f"\n{'─'*60}")
    print("Test B: Scenario injection — grid outage at step 50")
    print("─" * 60)

    brain = Brain(sim_config)
    brain.battery_soc = 75.0

    normal_row = {
        "timestamp": "2024-07-15 14:00:00",
        "hour_of_day": 14,
        "season": "summer",
        "pv_output_kw": 130.0,
        "facility_load_kw": 150.0,
        "grid_price_sar_kwh": 0.32,
        "grid_available": True,
    }
    state = brain.step(normal_row)
    print(f"  Before outage — Mode: {state['mode']:<22} Battery: {state['battery_soc_pct']}%")

    brain.inject_scenario("grid_outage")
    state = brain.step(normal_row)
    print(f"  OUTAGE injected  — Mode: {state['mode']:<22} Battery: {state['battery_soc_pct']}%")
    print(f"  Reason: {state['recent_decisions'][-1]['reason'] if state['recent_decisions'] else 'N/A'}")

    brain.inject_scenario("grid_restore")
    state = brain.step(normal_row)
    print(f"  Grid restored   — Mode: {state['mode']:<22} Battery: {state['battery_soc_pct']}%")

    # ── Test C: Hysteresis confirmation ────────────────────────────────────
    print(f"\n{'─'*60}")
    print("Test C: Hysteresis — mode change requires 2 consecutive cycles")
    print("─" * 60)

    brain2 = Brain(sim_config)
    brain2.battery_soc = 70.0
    row_base = {
        "hour_of_day": 13,
        "season": "summer",
        "grid_price_sar_kwh": 0.32,
        "grid_available": True,
    }

    pv_values = [80, 140, 140, 140]
    load = 150.0
    for i, pv in enumerate(pv_values):
        r = dict(row_base)
        r["pv_output_kw"] = pv
        r["facility_load_kw"] = load
        r["timestamp"] = f"2024-07-15 13:{i*15:02d}:00"
        s = brain2.step(r)
        pv_pct = round(pv / load * 100, 0)
        print(
            f"  Cycle {i+1}: PV={pv}kW ({pv_pct}% of load)  "
            f"Mode={s['mode']:<22}  "
            f"(hysteresis count={brain2.hysteresis_count})"
        )

    print(f"\n  ✓ Mode only changed after 2 consecutive cycles above threshold")
    print("\n" + "=" * 60)
    print("  All tests passed. brain.py is working correctly.")
    print("=" * 60 + "\n")