"""Pages-level Python helpers vendored into the Pyodide minimap bundle."""

from .scenario_facade import (
    analyse_scenario,
    build_analysis_summary,
    detect_scenario_details,
    museum_minimap_settings,
    parse_scenario_any,
    parse_scenario_to_match,
    scenario_minimap_r2_key,
    to_museum_minimap_webp_bytes_from_match,
)

__all__ = [
    "analyse_scenario",
    "build_analysis_summary",
    "detect_scenario_details",
    "museum_minimap_settings",
    "parse_scenario_any",
    "parse_scenario_to_match",
    "scenario_minimap_r2_key",
    "to_museum_minimap_webp_bytes_from_match",
]
