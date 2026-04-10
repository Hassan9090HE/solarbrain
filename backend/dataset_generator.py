"""
dataset_generator.py
Generates a synthetic but physically accurate energy dataset
shaped to the facility config from Layer 1.
Output: data/simulation.csv  (35,040 rows, 15-min intervals, full year)
"""

import pandas as pd
import numpy as np
import json
import os
from datetime import datetime, timedelta
import math


# ── Constants ─────────────────────────────────────────────────────────────────

SEASON_MAP = {
    1: "winter",  2: "winter",
    3: "moderate",4: "moderate", 5: "moderate",
    6: "summer",  7: "summer",   8: "summer",   9: "summer",
    10:"moderate",11:"moderate",
    12:"winter"
}

# Peak irradiance by season (W/m2 at solar noon)
PEAK_IRRADIANCE = {
    "summer":   1000,
    "moderate": 750,
    "winter":   430
}

# Panel surface temperature by season and hour (rough model)
PANEL_TEMP_AMBIENT = {
    "summer":   {"day": 65, "night": 35},
    "moderate": {"day": 48, "night": 22},
    "winter":   {"day": 32, "night": 15}
}

# Sunrise / sunset hours by season (approximate for SA)
DAYLIGHT = {
    "summer":   {"sunrise": 5.5,  "sunset": 19.0},
    "moderate": {"sunrise": 6.0,  "sunset": 18.0},
    "winter":   {"sunrise": 6.5,  "sunset": 17.0}
}

# Load shape multipliers by hour (0-23) — industrial shift pattern
FACILITY_LOAD_PROFILE = [
    0.45, 0.42, 0.40, 0.40, 0.42, 0.50,   # 00-05 (night/early)
    0.65, 0.82, 0.95, 1.00, 1.00, 1.00,   # 06-11 (morning ramp)
    0.98, 0.98, 1.00, 1.00, 0.98, 0.95,   # 12-17 (peak production)
    0.85, 0.75, 0.68, 0.60, 0.52, 0.47    # 18-23 (wind down)
]

FARM_LOAD_PROFILE = [
    0.20, 0.18, 0.18, 0.18, 0.20, 0.30,   # 00-05
    0.50, 0.80, 1.00, 1.00, 1.00, 1.00,   # 06-11 (pump hours)
    1.00, 1.00, 0.90, 0.80, 0.70, 0.55,   # 12-17
    0.40, 0.30, 0.25, 0.22, 0.20, 0.20    # 18-23
]

RESIDENTIAL_LOAD_PROFILE = [
    0.35, 0.30, 0.28, 0.28, 0.30, 0.38,   # 00-05 (sleep)
    0.50, 0.65, 0.70, 0.68, 0.65, 0.70,   # 06-11 (morning)
    0.75, 0.80, 0.85, 0.90, 0.95, 1.00,   # 12-17 (AC peak)
    0.95, 0.90, 0.82, 0.70, 0.58, 0.42    # 18-23 (evening)
]

# Grid price tiers by hour
def get_grid_price(hour, tariff_data):
    if 12 <= hour <= 17:
        return tariff_data["peak_rate_sar_kwh"]
    elif 22 <= hour or hour <= 6:
        return tariff_data["offpeak_rate_sar_kwh"]
    else:
        return tariff_data["rate_sar_kwh"]


# ── Solar irradiance model ────────────────────────────────────────────────────

def calculate_irradiance(hour_decimal, season, ghi_base):
    """
    Bell-curve solar irradiance model.
    Returns W/m2 for a given hour and season.
    hour_decimal: float 0.0 to 23.99
    """
    dl = DAYLIGHT[season]
    sunrise = dl["sunrise"]
    sunset  = dl["sunset"]

    if hour_decimal < sunrise or hour_decimal > sunset:
        return 0.0

    # Normalised position in day (0 at sunrise, 1 at sunset)
    day_len  = sunset - sunrise
    mid_day  = sunrise + day_len / 2
    pos      = (hour_decimal - mid_day) / (day_len / 2)

    # Gaussian bell curve
    raw = math.exp(-2.5 * pos ** 2)

    # Scale to season peak
    peak = PEAK_IRRADIANCE[season]
    irradiance = raw * peak

    # Add small random cloud variation (±8%)
    noise = np.random.uniform(-0.08, 0.08)
    irradiance *= (1 + noise)

    return max(0.0, irradiance)


def calculate_pv_output(irradiance_wm2, panel_temp_c, array_kwp,
                         temp_derating, soiling_factor, system_losses,
                         panel_temp_coeff=-0.34):
    """
    Convert irradiance to actual kW output with all SA derating factors.
    """
    if irradiance_wm2 <= 0:
        return 0.0

    # Temperature derating — extra loss above 25C STC
    temp_above_stc = max(0, panel_temp_c - 25)
    temp_loss = 1 + (panel_temp_coeff / 100) * temp_above_stc
    temp_loss = max(0.5, temp_loss)   # floor at 50% — physical limit

    # Actual output
    pv_output = (irradiance_wm2 / 1000) * array_kwp * temp_loss * soiling_factor * system_losses

    return max(0.0, round(pv_output, 3))


# ── Panel temperature model ───────────────────────────────────────────────────

def calculate_panel_temp(hour_decimal, season, irradiance_wm2):
    """Estimate panel surface temperature from ambient + irradiance heating."""
    temps = PANEL_TEMP_AMBIENT[season]
    if irradiance_wm2 <= 0:
        return float(temps["night"])

    # Day temp scales with irradiance
    irr_factor = irradiance_wm2 / 1000.0
    panel_temp = temps["night"] + (temps["day"] - temps["night"]) * irr_factor
    # Add noise
    panel_temp += np.random.uniform(-2, 2)
    return round(panel_temp, 1)


# ── Load profile ──────────────────────────────────────────────────────────────

def calculate_load(hour, user_type, peak_load_kw, season):
    """Calculate facility load for a given hour using shift-work profiles."""
    profiles = {
        "facility":    FACILITY_LOAD_PROFILE,
        "farm":        FARM_LOAD_PROFILE,
        "residential": RESIDENTIAL_LOAD_PROFILE
    }
    profile = profiles.get(user_type, FACILITY_LOAD_PROFILE)
    base = profile[hour] * peak_load_kw

    # Summer AC load boost for residential and facility
    if season == "summer" and user_type in ["residential", "facility"]:
        base *= 1.15
    # Winter slight load increase
    elif season == "winter":
        base *= 1.05

    # Add small random noise (±5%)
    noise = np.random.uniform(-0.05, 0.05)
    base *= (1 + noise)

    return round(max(0.1, base), 3)


# ── Main generator ────────────────────────────────────────────────────────────

def generate_dataset(facility_config: dict, output_path: str = None) -> pd.DataFrame:
    """
    Generate a full-year synthetic energy dataset shaped to the facility config.

    facility_config keys:
        user_type       : "facility" | "farm" | "residential"
        region          : "eastern" | "central" | "western"
        grid_scenario   : "on_grid" | "off_grid"
        peak_load_kw    : float
        critical_load_pct: float (0–100, optional, default 30)
        array_kwp       : float  (from sizing engine)
        battery_kwh     : float  (from sizing engine)
        dod_pct         : float  (from selected battery)
        ghi             : float  (from region)
        tariff          : dict   (from components.json tariffs)
        panel_temp_coeff: float  (from selected panel, default -0.34)
        has_generator   : bool   (off-grid only)
        generator_kva   : float  (optional)
        simulation_year : int    (default 1 — affects degradation)
    """

    np.random.seed(42)   # reproducible results

    user_type        = facility_config.get("user_type", "facility")
    region           = facility_config.get("region", "eastern")
    grid_scenario    = facility_config.get("grid_scenario", "on_grid")
    peak_load_kw     = float(facility_config.get("peak_load_kw", 100))
    critical_pct     = float(facility_config.get("critical_load_pct", 30)) / 100
    array_kwp        = float(facility_config.get("array_kwp", 100))
    battery_kwh      = float(facility_config.get("battery_kwh", 100))
    dod_pct          = float(facility_config.get("dod_pct", 90)) / 100
    ghi              = float(facility_config.get("ghi", 5.9))
    tariff           = facility_config.get("tariff", {
                           "rate_sar_kwh": 0.26,
                           "peak_rate_sar_kwh": 0.32,
                           "offpeak_rate_sar_kwh": 0.16,
                           "export_rate_sar_kwh": 0.16
                       })
    panel_temp_coeff = float(facility_config.get("panel_temp_coeff", -0.34))
    has_generator    = bool(facility_config.get("has_generator", False))
    generator_kva    = float(facility_config.get("generator_kva", 0))
    sim_year         = int(facility_config.get("simulation_year", 1))

    # SA derating factors
    temp_derating  = 0.82
    soiling_factor = 0.93
    system_losses  = 0.86
    degradation    = 0.99 ** sim_year   # e.g. year 1 = 0.99, year 5 = 0.951

    # Battery state
    floor_soc      = (1 - dod_pct) * 100   # e.g. 10 for 90% DoD
    battery_soc    = 80.0                   # start at 80% SOC
    usable_kwh     = battery_kwh * dod_pct

    # Generator
    gen_kw_max = generator_kva * 0.8 if has_generator else 0.0

    # Build timestamp index — full year at 15-min intervals
    start  = datetime(2024, 1, 1, 0, 0, 0)
    end    = datetime(2024, 12, 31, 23, 45, 0)
    index  = pd.date_range(start=start, end=end, freq="15min")

    rows = []

    for ts in index:
        month        = ts.month
        hour         = ts.hour
        minute       = ts.minute
        hour_decimal = hour + minute / 60.0
        season       = SEASON_MAP[month]
        is_weekend   = ts.weekday() >= 5

        # ── Solar ──
        irradiance = calculate_irradiance(hour_decimal, season, ghi)
        # Scale to actual location GHI (model uses 6.0 base)
        irradiance *= (ghi / 6.0)
        # Apply annual degradation
        irradiance_effective = irradiance * degradation

        panel_temp = calculate_panel_temp(hour_decimal, season, irradiance)

        pv_output = calculate_pv_output(
            irradiance_effective, panel_temp, array_kwp,
            temp_derating, soiling_factor, system_losses, panel_temp_coeff
        )

        # ── Load ──
        load = calculate_load(hour, user_type, peak_load_kw, season)
        # Weekends: 30% lower for facility, 20% lower for others
        if is_weekend:
            factor = 0.70 if user_type == "facility" else 0.80
            load *= factor

        critical_load  = round(load * critical_pct, 3)
        shiftable_load = round(load * 0.25, 3)   # 25% of load is shiftable

        # ── Grid price ──
        grid_price = get_grid_price(hour, tariff) if grid_scenario == "on_grid" else 0.0
        is_peak_hour   = (12 <= hour <= 17)
        is_offpeak     = (hour <= 6 or hour >= 22)
        grid_available = (grid_scenario == "on_grid")   # scenarios can override this

        # ── Battery dynamics ──
        interval_hours = 0.25   # 15 min = 0.25 h
        battery_charge_kw    = 0.0
        battery_discharge_kw = 0.0

        # ── Energy source decision (simplified for dataset — full brain in brain.py) ──
        solar_to_load   = min(pv_output, load)
        solar_surplus   = max(0, pv_output - load)
        load_deficit    = max(0, load - pv_output)
        grid_draw_kw    = 0.0
        grid_export_kw  = 0.0
        gen_output_kw   = 0.0
        mode            = "GRID_ONLY"

        if not grid_available:
            # Off-grid or emergency
            available_batt_kwh = (battery_soc - floor_soc) / 100 * battery_kwh
            batt_can_cover     = available_batt_kwh / interval_hours

            if pv_output >= load * 0.9 and battery_soc > floor_soc + 10:
                mode                 = "SOLAR_ONLY"
                battery_charge_kw    = min(solar_surplus, usable_kwh / interval_hours * 0.2)
            elif has_generator and battery_soc <= floor_soc:
                mode          = "GENERATOR_BACKUP"
                gen_output_kw = min(gen_kw_max, load - pv_output)
            else:
                if batt_can_cover > 0:
                    mode                 = "HYBRID"
                    battery_discharge_kw = min(load_deficit, batt_can_cover, usable_kwh / interval_hours)
                else:
                    mode = "GRID_ONLY"   # no power — blackout scenario

        else:
            # On-grid
            if pv_output >= load * 0.92 and battery_soc > floor_soc + 10:
                mode = "SOLAR_ONLY"
                # Charge battery from surplus
                if solar_surplus > 0:
                    if battery_soc < 95:
                        battery_charge_kw = min(solar_surplus, usable_kwh / interval_hours * 0.3)
                    else:
                        grid_export_kw = solar_surplus

            elif is_peak_hour and battery_soc > 42:
                mode                 = "BATTERY_BACKUP"
                battery_discharge_kw = min(load_deficit, usable_kwh / interval_hours * 0.4)
                grid_draw_kw         = max(0, load - pv_output - battery_discharge_kw)

            elif pv_output >= load * 0.52:
                mode         = "HYBRID"
                grid_draw_kw = max(0, load - pv_output)
                if solar_surplus > 0 and battery_soc < 95:
                    battery_charge_kw = min(solar_surplus, usable_kwh / interval_hours * 0.2)
                elif solar_surplus > 0 and battery_soc >= 95:
                    grid_export_kw = solar_surplus

            elif is_offpeak and battery_soc < 23:
                mode              = "CHARGE_MODE"
                grid_draw_kw      = load + min(usable_kwh / interval_hours * 0.3, (100 - battery_soc) / 100 * battery_kwh / interval_hours)
                battery_charge_kw = grid_draw_kw - load

            else:
                mode         = "GRID_ONLY"
                grid_draw_kw = load

        # ── Update battery SOC ──
        energy_in  = battery_charge_kw    * interval_hours
        energy_out = battery_discharge_kw * interval_hours
        battery_soc += (energy_in / battery_kwh * 100) - (energy_out / battery_kwh * 100)
        battery_soc  = max(floor_soc, min(100, battery_soc))

        # ── KPIs ──
        grid_co2_factor  = 0.72   # kg CO2 per kWh — SA grid average
        co2_saved_kg     = round(solar_to_load * interval_hours * grid_co2_factor, 4)
        cost_sar         = round(grid_draw_kw * interval_hours * grid_price, 4)
        gen_fuel_sar     = round(gen_output_kw * interval_hours * 0.25 * 0.75, 4) if gen_output_kw > 0 else 0.0
        net_meter_rev    = round(grid_export_kw * interval_hours * tariff.get("export_rate_sar_kwh", 0.12), 4)
        solar_util_pct   = round((solar_to_load / pv_output * 100) if pv_output > 0 else 0.0, 1)
        grid_dep_pct     = round((grid_draw_kw / load * 100) if load > 0 else 0.0, 1)

        rows.append({
            "timestamp":               ts,
            "season":                  season,
            "month":                   month,
            "hour_of_day":             hour,
            "is_weekend":              is_weekend,
            "is_peak_hour":            is_peak_hour,
            "solar_irradiance_wm2":    round(irradiance, 2),
            "panel_temp_celsius":      panel_temp,
            "pv_output_kw":            pv_output,
            "facility_load_kw":        load,
            "critical_load_kw":        critical_load,
            "shiftable_load_kw":       shiftable_load,
            "battery_soc_pct":         round(battery_soc, 2),
            "battery_charge_kw":       round(battery_charge_kw, 3),
            "battery_discharge_kw":    round(battery_discharge_kw, 3),
            "grid_draw_kw":            round(grid_draw_kw, 3),
            "grid_export_kw":          round(grid_export_kw, 3),
            "grid_price_sar_kwh":      grid_price,
            "grid_available":          grid_available,
            "generator_output_kw":     round(gen_output_kw, 3),
            "generator_fuel_cost_sar": gen_fuel_sar,
            "energy_source_mode":      mode,
            "co2_saved_kg":            co2_saved_kg,
            "cost_sar":                cost_sar,
            "net_metering_revenue_sar":net_meter_rev,
            "solar_utilization_pct":   solar_util_pct,
            "grid_dependency_pct":     grid_dep_pct,
        })

    df = pd.DataFrame(rows)

    if output_path:
        df.to_csv(output_path, index=False)
        print(f"Dataset saved to {output_path}")
        print(f"Rows: {len(df):,}  |  Columns: {len(df.columns)}")

    return df


# ── Quick test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Load components to get a tariff
    components_path = os.path.join(os.path.dirname(__file__), "..", "data", "components.json")
    with open(components_path) as f:
        components = json.load(f)

    # Example: medium industrial facility in Eastern Region, on-grid
    test_config = {
        "user_type":         "facility",
        "region":            "eastern",
        "grid_scenario":     "on_grid",
        "peak_load_kw":      500,
        "critical_load_pct": 30,
        "array_kwp":         620,
        "battery_kwh":       960,
        "dod_pct":           90,
        "ghi":               5.9,
        "tariff":            components["tariffs"]["facility"],
        "panel_temp_coeff":  -0.30,
        "has_generator":     False,
        "simulation_year":   1
    }

    output_path = os.path.join(os.path.dirname(__file__), "..", "data", "simulation.csv")
    df = generate_dataset(test_config, output_path=output_path)

    # Print a sample — one row per season at noon
    print("\nSample rows (noon, first month of each season):")
    sample = df[
        (df["hour_of_day"] == 12) &
        (df["month"].isin([1, 4, 7])) &
        (df["timestamp"].dt.day == 15)
    ][["timestamp", "season", "solar_irradiance_wm2", "pv_output_kw",
       "facility_load_kw", "battery_soc_pct", "energy_source_mode",
       "cost_sar", "co2_saved_kg"]]
    print(sample.to_string(index=False))

    # Summary stats
    print("\nAnnual summary:")
    print(f"  Total solar generated:  {df['pv_output_kw'].sum() * 0.25:,.0f} kWh")
    print(f"  Total grid drawn:       {df['grid_draw_kw'].sum() * 0.25:,.0f} kWh")
    print(f"  Total CO2 saved:        {df['co2_saved_kg'].sum():,.0f} kg")
    print(f"  Total SAR cost paid:    {df['cost_sar'].sum():,.0f} SAR")
    print(f"  Total grid exported:    {df['grid_export_kw'].sum() * 0.25:,.0f} kWh")
    print(f"  Net metering revenue:   {df['net_metering_revenue_sar'].sum():,.0f} SAR")
    print(f"  Avg solar utilization:  {df['solar_utilization_pct'].mean():.1f}%")
    print(f"  Avg grid dependency:    {df['grid_dependency_pct'].mean():.1f}%")
    print(f"\nMode distribution:")
    print(df["energy_source_mode"].value_counts().to_string())
