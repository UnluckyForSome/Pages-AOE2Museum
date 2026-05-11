from __future__ import annotations

from AoE2ScenarioParser.scenario_detection import detect_scenario_edition
from AoE2ScenarioParser.scenario_parsing import parse_scenario
from aoe2_mcminimap import match_from_parsed_scenario


def _coerce_bytes(file_bytes) -> bytes:
    if hasattr(file_bytes, "to_py"):
        return bytes(file_bytes.to_py())
    return bytes(file_bytes)


def detect_scenario_details(file_bytes):
    detection = detect_scenario_edition(_coerce_bytes(file_bytes))
    return {
        "edition": detection.edition.value,
        "containerFormat": detection.container_format,
        "dataVersion": detection.data_version,
        "isDefinitiveEdition": detection.is_definitive_edition,
        "reason": detection.reason,
    }


def parse_scenario_any(file_bytes, *, name: str = "uploaded scenario"):
    return parse_scenario(_coerce_bytes(file_bytes), name=name, suppress_output=True)


def parse_scenario_to_match(file_bytes, *, name: str = "uploaded scenario"):
    return match_from_parsed_scenario(parse_scenario_any(file_bytes, name=name))
