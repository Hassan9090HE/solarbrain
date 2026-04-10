"""
sizing_engine.py
Takes a facility profile from the user form and returns a complete
system design with component recommendations, specs, and financials.

Input  : facility_profile  (dict — from the Layer 1 form)
Output : system_design      (dict — feeds Layer 2 and the UI)
"""

import json
import math
import os


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 1 — Load component database
# ══════════════════════════════════════════════════════════════════════════════

def load_components():
    """Load components.json from the data folder."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    path     = os.path.join(base_dir, "..", "data", "components.json")
    with open(path, "r") as f:
        return json.load(f)


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 2 — Helper functions
# ══════════════════════════════════════════════════════════════════════════════

def get_tier(peak_load_kw: float) -> int:
    """Detect load tier from peak demand."""
    if peak_load_kw <= 30:
        return 1
    elif peak_load_kw <= 500:
        return 2
    else:
        return 3


def score_panel(panel: dict, budget_left: float = None) -> float:
    """
    Score a panel for ranking.
    efficiency 40% + price per watt 40% + warranty 20%
    Higher score = better recommendation.
    """
    eff_score     = panel["efficiency_pct"] / 25.0          # normalise to ~0-1
    price_per_wp  = panel["price_sar"] / panel["power_wp"]
    price_score   = 1 - (price_per_wp / 1.0)                # lower price = higher score
    warranty_score= panel["warranty_years"] / 30.0
    return (eff_score * 0.40) + (price_score * 0.40) + (warranty_score * 0.20)


def score_inverter(inv: dict) -> float:
    """
    Score an inverter for ranking.
    efficiency 40% + price per kw 40% + warranty 20%
    """
    eff_score      = inv["efficiency_pct"] / 100.0
    price_per_kw   = inv["price_sar"] / inv["capacity_kw"]
    price_score    = 1 - (price_per_kw / 500.0)             # normalise
    warranty_score = inv["warranty_years"] / 10.0
    return (eff_score * 0.40) + (price_score * 0.40) + (warranty_score * 0.20)


def score_battery(bat: dict) -> float:
    """
    Score a battery for ranking.
    cycle_life 40% + price per kWh 40% + DoD 20%
    """
    cycle_score    = bat["cycle_life"] / 8000.0
    price_per_kwh  = bat["price_sar"] / bat["capacity_kwh"]
    price_score    = 1 - (price_per_kwh / 1500.0)           # normalise
    dod_score      = bat["dod_pct"] / 100.0
    return (cycle_score * 0.40) + (price_score * 0.40) + (dod_score * 0.20)


def filter_components(components: list, tier: int, grid_scenario: str) -> list:
    """
    Filter a component list by tier and grid scenario compatibility.
    grid_scenario: "on_grid" or "off_grid"
    """
    valid_scenarios = {"both", grid_scenario}
    return [
        c for c in components
        if c["tier"] == tier
        and c.get("grid_scenario", "both") in valid_scenarios
    ]


def select_top3(candidates: list, score_fn) -> list:
    """Sort candidates by score and return top 3 with labels."""
    ranked = sorted(candidates, key=score_fn, reverse=True)[:3]
    labels = ["Best value", "Best performance", "Budget option"]
    result = []
    for i, item in enumerate(ranked):
        entry = dict(item)
        entry["recommendation_label"] = labels[i] if i < len(labels) else f"Option {i+1}"
        entry["score"] = round(score_fn(item), 4)
        result.append(entry)
    return result


def calculate_protection_items(inv_kw: float, tier: int,
                                grid_scenario: str, inv_units: int,
                                components: dict) -> dict:
    """
    Auto-assign all protection and BOS items.
    Returns a dict of items with specs and total cost.
    """
    p    = components["protection_items"]
    items = {}
    total = 0

    # DC MCB — one per inverter unit
    dc_amps = round((inv_kw * 1000 / 600) * 1.25, 0)  # 600V DC typical
    items["dc_mcb"] = {
        "description": p["dc_mcb"]["description"],
        "spec":        f"{int(dc_amps)}A DC",
        "quantity":    inv_units,
        "unit_price":  p["dc_mcb"]["price_sar_per_unit"],
        "total_price": p["dc_mcb"]["price_sar_per_unit"] * inv_units
    }
    total += items["dc_mcb"]["total_price"]

    # AC MCCB — one per inverter unit
    ac_amps = round((inv_kw * 1000 / 380) * 1.25, 0)   # 3-phase 380V
    items["ac_mccb"] = {
        "description": p["ac_mccb"]["description"],
        "spec":        f"{int(ac_amps)}A AC 3-phase",
        "quantity":    inv_units,
        "unit_price":  p["ac_mccb"]["price_sar_per_unit"],
        "total_price": p["ac_mccb"]["price_sar_per_unit"] * inv_units
    }
    total += items["ac_mccb"]["total_price"]

    # SPD — surge protection
    spd_key  = "spd_type1_2" if tier == 3 else "spd_type2"
    spd_item = p[spd_key]
    items["spd"] = {
        "description": spd_item["description"],
        "spec":        "Type I+II" if tier == 3 else "Type II",
        "quantity":    1,
        "unit_price":  spd_item["price_sar_per_unit"],
        "total_price": spd_item["price_sar_per_unit"]
    }
    total += items["spd"]["total_price"]

    # AC disconnect + bidirectional meter — on-grid only
    if grid_scenario == "on_grid":
        items["ac_disconnect"] = {
            "description": p["ac_disconnect"]["description"],
            "spec":        "SEC anti-islanding required",
            "quantity":    1,
            "unit_price":  p["ac_disconnect"]["price_sar_per_unit"],
            "total_price": p["ac_disconnect"]["price_sar_per_unit"]
        }
        items["energy_meter"] = {
            "description": p["bidirectional_meter"]["description"],
            "spec":        "Bidirectional — SEC net metering",
            "quantity":    1,
            "unit_price":  p["bidirectional_meter"]["price_sar_per_unit"],
            "total_price": p["bidirectional_meter"]["price_sar_per_unit"]
        }
        total += items["ac_disconnect"]["total_price"]
        total += items["energy_meter"]["total_price"]
    else:
        items["energy_meter"] = {
            "description": p["standalone_meter"]["description"],
            "spec":        "Standalone consumption meter",
            "quantity":    1,
            "unit_price":  p["standalone_meter"]["price_sar_per_unit"],
            "total_price": p["standalone_meter"]["price_sar_per_unit"]
        }
        total += items["energy_meter"]["total_price"]

    items["_total_sar"] = round(total, 2)
    return items


def calculate_mounting_and_cabling(panel_count: int, inv_kw: float,
                                    components: dict) -> dict:
    """
    Estimate mounting structure and cable costs.
    Returns dict with breakdown and total.
    """
    p = components["protection_items"]

    mounting_cost = panel_count * p["mounting_structure_per_panel"]["price_sar_per_panel"]
    dc_cable_m    = panel_count * 15           # ~15m average run per panel string
    ac_cable_m    = 20 * math.ceil(inv_kw / 50) # 20m per inverter
    dc_cable_cost = dc_cable_m * p["dc_cable_per_meter"]["price_sar_per_meter"]
    ac_cable_cost = ac_cable_m * p["ac_cable_per_meter"]["price_sar_per_meter"]

    return {
        "mounting_structure": {
            "description": "Rooftop mounting structure",
            "quantity":    panel_count,
            "unit_price":  p["mounting_structure_per_panel"]["price_sar_per_panel"],
            "total_price": round(mounting_cost, 2)
        },
        "dc_cable": {
            "description": "DC solar cable 6mm²",
            "meters":      dc_cable_m,
            "unit_price":  p["dc_cable_per_meter"]["price_sar_per_meter"],
            "total_price": round(dc_cable_cost, 2)
        },
        "ac_cable": {
            "description": "AC output cable 10mm²",
            "meters":      ac_cable_m,
            "unit_price":  p["ac_cable_per_meter"]["price_sar_per_meter"],
            "total_price": round(ac_cable_cost, 2)
        },
        "_total_sar": round(mounting_cost + dc_cable_cost + ac_cable_cost, 2)
    }


def calculate_financial_model(array_kwp: float, ghi: float,
                               performance_ratio: float, tariff: dict,
                               grid_scenario: str, capex_total: float,
                               monthly_bill_sar: float,
                               has_generator: bool = False,
                               generator_kva: float = 0,
                               years: int = 10) -> dict:
    """
    Build the financial model for 1, 5, and 10 years.
    Returns yearly savings, cumulative savings, and break-even year.
    """
    annual_degradation = 0.99

    yearly_data = []
    cumulative_savings  = 0.0
    break_even_year     = None

    for yr in range(1, years + 1):
        # Panel degradation
        degradation_factor  = annual_degradation ** yr

        # Annual solar production
        production_kwh      = array_kwp * ghi * 365 * performance_ratio * degradation_factor

        # Grid savings
        grid_savings        = production_kwh * tariff.get("rate_sar_kwh", 0.22)

        # Net metering export revenue (on-grid only — assume 20% exported)
        export_revenue      = 0.0
        if grid_scenario == "on_grid":
            export_kwh      = production_kwh * 0.20
            export_revenue  = export_kwh * tariff.get("export_rate_sar_kwh", 0.12)

        # Diesel savings (off-grid — assume 30% of load hours replaced by solar)
        diesel_savings      = 0.0
        if has_generator and grid_scenario == "off_grid":
            gen_kw          = generator_kva * 0.8
            hours_replaced  = 365 * 6 * degradation_factor   # ~6h/day replaced by solar
            fuel_saved_L    = gen_kw * hours_replaced * 0.25
            diesel_savings  = fuel_saved_L * 0.75             # 0.75 SAR/L

        total_savings_yr    = round(grid_savings + export_revenue + diesel_savings, 2)
        cumulative_savings += total_savings_yr

        # Baseline — what they would pay without the system
        annual_baseline     = monthly_bill_sar * 12

        yearly_data.append({
            "year":              yr,
            "production_kwh":    round(production_kwh, 0),
            "grid_savings_sar":  round(grid_savings, 2),
            "export_revenue_sar":round(export_revenue, 2),
            "diesel_savings_sar":round(diesel_savings, 2),
            "total_savings_sar": total_savings_yr,
            "cumulative_savings_sar": round(cumulative_savings, 2),
            "baseline_cost_sar": round(annual_baseline * yr, 2),
        })

        if break_even_year is None and cumulative_savings >= capex_total:
            break_even_year = yr

    # Milestone summaries
    def get_cumulative(yr):
        entry = next((d for d in yearly_data if d["year"] == yr), None)
        return entry["cumulative_savings_sar"] if entry else 0

    return {
        "capex_total_sar":          round(capex_total, 2),
        "monthly_savings_sar":      round(yearly_data[0]["total_savings_sar"] / 12, 2),
        "year_1_savings_sar":       get_cumulative(1),
        "year_5_savings_sar":       get_cumulative(5),
        "year_10_savings_sar":      get_cumulative(10),
        "break_even_year":          break_even_year,
        "baseline_10yr_cost_sar":   round(monthly_bill_sar * 12 * 10, 2),
        "net_10yr_benefit_sar":     round(get_cumulative(10) - capex_total, 2),
        "yearly_data":              yearly_data,
    }


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 3 — Main sizing function
# ══════════════════════════════════════════════════════════════════════════════

def size_system(profile: dict) -> dict:
    """
    Main entry point. Takes a user profile and returns a complete system design.

    Required profile keys:
        user_type         : "facility" | "farm" | "residential"
        region            : "eastern" | "central" | "western"
        grid_scenario     : "on_grid" | "off_grid"
        monthly_bill_sar  : float

    Optional keys (with defaults):
        peak_load_kw      : float  (derived from bill if missing)
        operating_hours   : float  (default 10)
        building_size_m2  : float  (informational)
        critical_load_pct : float  (default 30)
        has_generator     : bool   (default False)
        generator_kva     : float  (default 0)
        pump_power_kw     : float  (farm only — used as peak_load if present)
        pump_hours_day    : float  (farm only)
        ac_units          : int    (residential only)
        roof_area_m2      : float  (residential only — optional cap on panel count)
    """

    components = load_components()

    # ── Step 1: Resolve inputs ─────────────────────────────────────────────
    user_type        = profile.get("user_type", "facility")
    region           = profile.get("region", "eastern")
    grid_scenario    = profile.get("grid_scenario", "on_grid")
    monthly_bill     = float(profile.get("monthly_bill_sar", 10000))
    operating_hours  = float(profile.get("operating_hours", 10))
    critical_pct     = float(profile.get("critical_load_pct", 30))
    has_generator    = bool(profile.get("has_generator", False))
    generator_kva    = float(profile.get("generator_kva", 0))
    roof_area_m2     = profile.get("roof_area_m2")   # may be None

    tariff           = components["tariffs"][user_type]
    ghi              = components["regions"][region]["ghi_kwh_m2_day"]
    derating         = components["derating_factors"]
    constants        = components["sizing_constants"]

    # ── Step 2: Derive daily load ──────────────────────────────────────────
    rate             = tariff["rate_sar_kwh"]
    daily_load_kwh   = (monthly_bill / rate) / 30

    # Peak load
    if "peak_load_kw" in profile and profile["peak_load_kw"]:
        peak_load_kw = float(profile["peak_load_kw"])
    elif user_type == "farm" and profile.get("pump_power_kw"):
        pump_kw          = float(profile["pump_power_kw"])
        pump_hours       = float(profile.get("pump_hours_day", 8))
        daily_load_kwh   = pump_kw * pump_hours
        peak_load_kw     = pump_kw
    elif user_type == "residential" and profile.get("ac_units"):
        ac_kw            = float(profile["ac_units"]) * 2.5   # 2.5 kW per AC unit
        peak_load_kw     = ac_kw * 1.3
    else:
        peak_load_kw = (daily_load_kwh / operating_hours) * constants["peak_load_factor"]

    peak_load_kw = round(peak_load_kw, 2)
    tier         = get_tier(peak_load_kw)

    # ── Step 3: PV array sizing ────────────────────────────────────────────
    perf_ratio   = derating["performance_ratio"]      # 0.655
    safety       = (constants["safety_factor_on_grid"]
                    if grid_scenario == "on_grid"
                    else constants["safety_factor_off_grid"])

    pv_kwp_required = (daily_load_kwh / (ghi * perf_ratio)) * safety
    pv_kwp_required = round(pv_kwp_required, 2)

    # ── Step 4: Battery sizing ─────────────────────────────────────────────
    autonomy_h   = (constants["autonomy_hours_on_grid"]
                    if grid_scenario == "on_grid"
                    else constants["autonomy_hours_off_grid"])

    # Use best available battery DoD for calculation (we use 90% as default)
    default_dod  = 0.90
    batt_kwh_req = (peak_load_kw * autonomy_h) / default_dod
    batt_kwh_req = round(batt_kwh_req, 2)

    # ── Step 5: Inverter sizing ────────────────────────────────────────────
    inv_kw_req   = peak_load_kw * constants["inverter_oversize_factor"]
    inv_kw_req   = round(inv_kw_req, 2)

    # ── Step 6: Generator sizing (off-grid only) ───────────────────────────
    gen_spec     = None
    if has_generator and grid_scenario == "off_grid":
        if generator_kva == 0:
            generator_kva = round(inv_kw_req / constants["generator_power_factor"], 1)
        fuel_lph  = generator_kva * 0.8 * constants["diesel_consumption_lph_per_kva"]
        gen_spec  = {
            "kva":                 round(generator_kva, 1),
            "kw_output":           round(generator_kva * 0.8, 1),
            "fuel_consumption_lph":round(fuel_lph, 2),
            "estimated_annual_cost_sar": round(fuel_lph * 8760 * 0.3 *
                                               constants["diesel_price_sar_per_liter"], 0)
        }

    # ── Step 7: Select components from database ────────────────────────────

    # Panels
    panel_candidates = filter_components(components["panels"], tier, grid_scenario)
    top_panels       = select_top3(panel_candidates, score_panel)

    # For each panel option calculate unit count and area
    for p in top_panels:
        p["units_required"]  = math.ceil(pv_kwp_required * 1000 / p["power_wp"])
        p["actual_kwp"]      = round(p["units_required"] * p["power_wp"] / 1000, 2)
        p["roof_area_m2"]    = round(p["units_required"] * p["area_m2"], 1)
        p["panels_cost_sar"] = p["units_required"] * p["price_sar"]

        # Cap by roof area if provided (residential)
        if roof_area_m2 and p["roof_area_m2"] > float(roof_area_m2):
            max_panels           = int(float(roof_area_m2) / p["area_m2"])
            p["units_required"]  = max_panels
            p["actual_kwp"]      = round(max_panels * p["power_wp"] / 1000, 2)
            p["roof_area_m2"]    = round(max_panels * p["area_m2"], 1)
            p["panels_cost_sar"] = max_panels * p["price_sar"]
            p["roof_limited"]    = True
        else:
            p["roof_limited"]    = False

    # Inverters
    inv_candidates = filter_components(components["inverters"], tier, grid_scenario)
    top_inverters  = select_top3(inv_candidates, score_inverter)

    for inv in top_inverters:
        inv["units_required"]  = math.ceil(inv_kw_req / inv["capacity_kw"])
        inv["actual_kw"]       = round(inv["units_required"] * inv["capacity_kw"], 1)
        inv["inverter_cost_sar"] = inv["units_required"] * inv["price_sar"]

    # Batteries
    bat_candidates = filter_components(components["batteries"], tier, grid_scenario)
    top_batteries  = select_top3(bat_candidates, score_battery)

    for bat in top_batteries:
        dod            = bat["dod_pct"] / 100
        kwh_req_actual = (peak_load_kw * autonomy_h) / dod
        bat["units_required"]   = math.ceil(kwh_req_actual / bat["capacity_kwh"])
        bat["actual_kwh"]       = round(bat["units_required"] * bat["capacity_kwh"], 1)
        bat["floor_soc_pct"]    = round((1 - dod) * 100, 1)
        bat["battery_cost_sar"] = bat["units_required"] * bat["price_sar"]

    # ── Step 8: Protection items and BOS ──────────────────────────────────
    # Use the top-ranked inverter for protection sizing
    best_inv       = top_inverters[0]
    protection     = calculate_protection_items(
                         best_inv["actual_kw"], tier, grid_scenario,
                         best_inv["units_required"], components)

    best_panel     = top_panels[0]
    bos            = calculate_mounting_and_cabling(
                         best_panel["units_required"], best_inv["actual_kw"],
                         components)

    # ── Step 9: CAPEX total ────────────────────────────────────────────────
    best_battery   = top_batteries[0]
    capex_panels   = best_panel["panels_cost_sar"]
    capex_inverter = best_inv["inverter_cost_sar"]
    capex_battery  = best_battery["battery_cost_sar"]
    capex_prot     = protection["_total_sar"]
    capex_bos      = bos["_total_sar"]
    capex_total    = round(capex_panels + capex_inverter + capex_battery +
                           capex_prot + capex_bos, 2)

    # ── Step 10: Financial model ───────────────────────────────────────────
    financials = calculate_financial_model(
        array_kwp        = best_panel["actual_kwp"],
        ghi              = ghi,
        performance_ratio= perf_ratio,
        tariff           = tariff,
        grid_scenario    = grid_scenario,
        capex_total      = capex_total,
        monthly_bill_sar = monthly_bill,
        has_generator    = has_generator,
        generator_kva    = generator_kva,
        years            = 10
    )

    # ── Assemble output ────────────────────────────────────────────────────
    system_design = {
        # Input summary
        "profile": {
            "user_type":        user_type,
            "region":           region,
            "region_name":      components["regions"][region]["name"],
            "grid_scenario":    grid_scenario,
            "monthly_bill_sar": monthly_bill,
            "peak_load_kw":     peak_load_kw,
            "daily_load_kwh":   round(daily_load_kwh, 1),
            "tier":             tier,
            "ghi":              ghi,
            "critical_load_pct":critical_pct,
        },

        # Sizing requirements
        "requirements": {
            "pv_kwp_required":     pv_kwp_required,
            "battery_kwh_required":batt_kwh_req,
            "inverter_kw_required":inv_kw_req,
            "autonomy_hours":      autonomy_h,
            "performance_ratio":   perf_ratio,
            "safety_factor":       safety,
        },

        # Component recommendations (top 3 each)
        "panels":    top_panels,
        "inverters": top_inverters,
        "batteries": top_batteries,

        # Auto-assigned items
        "protection_items": protection,
        "bos":              bos,

        # Generator (off-grid only)
        "generator": gen_spec,

        # Financial summary (using top-ranked components)
        "financials": financials,

        # Capex breakdown
        "capex_breakdown": {
            "panels_sar":    capex_panels,
            "inverter_sar":  capex_inverter,
            "battery_sar":   capex_battery,
            "protection_sar":capex_prot,
            "bos_sar":       capex_bos,
            "total_sar":     capex_total,
        },

        # Config passed to dataset generator and Layer 2
        "simulation_config": {
            "user_type":         user_type,
            "region":            region,
            "grid_scenario":     grid_scenario,
            "peak_load_kw":      peak_load_kw,
            "critical_load_pct": critical_pct,
            "array_kwp":         best_panel["actual_kwp"],
            "battery_kwh":       best_battery["actual_kwh"],
            "dod_pct":           best_battery["dod_pct"],
            "ghi":               ghi,
            "tariff":            tariff,
            "panel_temp_coeff":  best_panel.get("temp_coefficient_pct", -0.34),
            "has_generator":     has_generator,
            "generator_kva":     generator_kva,
            "simulation_year":   1,
        }
    }

    return system_design


# ══════════════════════════════════════════════════════════════════════════════
# SECTION 4 — Test block
# ══════════════════════════════════════════════════════════════════════════════

def print_design(design: dict):
    """Pretty-print the system design to the terminal."""
    p   = design["profile"]
    req = design["requirements"]
    fin = design["financials"]
    cap = design["capex_breakdown"]

    print("\n" + "="*60)
    print("  SOLARBRAIN — SYSTEM DESIGN RESULT")
    print("="*60)

    print(f"\n  User type    : {p['user_type'].upper()}")
    print(f"  Region       : {p['region_name']}  (GHI {p['ghi']} kWh/m²/day)")
    print(f"  Scenario     : {p['grid_scenario'].upper()}")
    print(f"  Monthly bill : {p['monthly_bill_sar']:,.0f} SAR")
    print(f"  Peak load    : {p['peak_load_kw']:,.1f} kW   |   Daily load: {p['daily_load_kwh']:,.0f} kWh")
    print(f"  Load tier    : Tier {p['tier']}")

    print(f"\n{'─'*60}")
    print("  SIZING REQUIREMENTS")
    print(f"{'─'*60}")
    print(f"  PV array     : {req['pv_kwp_required']:,.1f} kWp  (safety {req['safety_factor']}x)")
    print(f"  Battery      : {req['battery_kwh_required']:,.1f} kWh  ({req['autonomy_hours']}h autonomy)")
    print(f"  Inverter     : {req['inverter_kw_required']:,.1f} kW minimum")

    print(f"\n{'─'*60}")
    print("  TOP PANEL RECOMMENDATION")
    print(f"{'─'*60}")
    for i, panel in enumerate(design["panels"]):
        print(f"  [{panel['recommendation_label']}]")
        print(f"    {panel['brand']} {panel['model']}")
        print(f"    {panel['units_required']} panels × {panel['power_wp']}Wp "
              f"= {panel['actual_kwp']} kWp  |  {panel['roof_area_m2']} m²  "
              f"|  {panel['panels_cost_sar']:,.0f} SAR")

    print(f"\n{'─'*60}")
    print("  TOP INVERTER RECOMMENDATION")
    print(f"{'─'*60}")
    for inv in design["inverters"]:
        print(f"  [{inv['recommendation_label']}]")
        print(f"    {inv['brand']} {inv['model']}")
        print(f"    {inv['units_required']} unit(s) × {inv['capacity_kw']} kW "
              f"= {inv['actual_kw']} kW  |  {inv['inverter_cost_sar']:,.0f} SAR")

    print(f"\n{'─'*60}")
    print("  TOP BATTERY RECOMMENDATION")
    print(f"{'─'*60}")
    for bat in design["batteries"]:
        print(f"  [{bat['recommendation_label']}]")
        print(f"    {bat['brand']} {bat['model']}")
        print(f"    {bat['units_required']} unit(s) × {bat['capacity_kwh']} kWh "
              f"= {bat['actual_kwh']} kWh  |  DoD {bat['dod_pct']}%  "
              f"|  {bat['battery_cost_sar']:,.0f} SAR")

    if design["generator"]:
        g = design["generator"]
        print(f"\n{'─'*60}")
        print("  GENERATOR (OFF-GRID)")
        print(f"{'─'*60}")
        print(f"    {g['kva']} kVA  →  {g['kw_output']} kW output")
        print(f"    Fuel consumption: {g['fuel_consumption_lph']} L/h")
        print(f"    Est. annual fuel cost: {g['estimated_annual_cost_sar']:,.0f} SAR")

    print(f"\n{'─'*60}")
    print("  CAPEX BREAKDOWN")
    print(f"{'─'*60}")
    print(f"    Panels        : {cap['panels_sar']:>12,.0f} SAR")
    print(f"    Inverter(s)   : {cap['inverter_sar']:>12,.0f} SAR")
    print(f"    Battery(ies)  : {cap['battery_sar']:>12,.0f} SAR")
    print(f"    Protection    : {cap['protection_sar']:>12,.0f} SAR")
    print(f"    Mounting/Cable: {cap['bos_sar']:>12,.0f} SAR")
    print(f"    {'─'*26}")
    print(f"    TOTAL         : {cap['total_sar']:>12,.0f} SAR")

    print(f"\n{'─'*60}")
    print("  FINANCIAL SUMMARY")
    print(f"{'─'*60}")
    print(f"    Monthly savings : {fin['monthly_savings_sar']:>10,.0f} SAR")
    print(f"    Year 1 savings  : {fin['year_1_savings_sar']:>10,.0f} SAR")
    print(f"    Year 5 savings  : {fin['year_5_savings_sar']:>10,.0f} SAR")
    print(f"    Year 10 savings : {fin['year_10_savings_sar']:>10,.0f} SAR")
    bey = fin['break_even_year']
    print(f"    Break-even      : {'Year ' + str(bey) if bey else 'Beyond 10 years'}")
    print(f"    10yr net benefit: {fin['net_10yr_benefit_sar']:>10,.0f} SAR")
    print(f"    10yr baseline   : {fin['baseline_10yr_cost_sar']:>10,.0f} SAR  (without system)")
    print("="*60 + "\n")


if __name__ == "__main__":
    print("\nTest 1: Medium industrial facility — Eastern Region — On-grid")
    design1 = size_system({
        "user_type":        "facility",
        "region":           "eastern",
        "grid_scenario":    "on_grid",
        "monthly_bill_sar": 45000,
        "peak_load_kw":     850,
        "operating_hours":  14,
        "critical_load_pct":35,
    })
    print_design(design1)

    print("\nTest 2: Agricultural farm — Central Region — Off-grid with generator")
    design2 = size_system({
        "user_type":        "farm",
        "region":           "central",
        "grid_scenario":    "off_grid",
        "monthly_bill_sar": 8000,
        "pump_power_kw":    75,
        "pump_hours_day":   8,
        "has_generator":    True,
        "generator_kva":    100,
    })
    print_design(design2)

    print("\nTest 3: Residential — Western Region — On-grid")
    design3 = size_system({
        "user_type":        "residential",
        "region":           "western",
        "grid_scenario":    "on_grid",
        "monthly_bill_sar": 1800,
        "ac_units":         5,
        "building_size_m2": 350,
        "roof_area_m2":     120,
    })
    print_design(design3)
print("\nTest 4: Balanced facility — Central Region — On-grid")
design4 = size_system({
    "user_type":        "facility",
    "region":           "central",
    "grid_scenario":    "on_grid",
    "monthly_bill_sar": 15000,
    "peak_load_kw":     150,
    "operating_hours":  14,
    "critical_load_pct":20,
    "building_size_m2": 1800
})
print_design(design4)

print("\nTest 5: Strong showcase facility — Central Region — On-grid")
design5 = size_system({
    "user_type":        "facility",
    "region":           "central",
    "grid_scenario":    "on_grid",
    "monthly_bill_sar": 18000,
    "peak_load_kw":     180,
    "operating_hours":  16,
    "critical_load_pct":20,
    "building_size_m2": 2200
})
print_design(design5)