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


def _player_summary(player, slot: int):
    position = getattr(player, "position", None)
    pos_x = getattr(position, "x", None) if position is not None else None
    pos_y = getattr(position, "y", None) if position is not None else None
    object_count = len(getattr(player, "objects", []) or [])
    has_start_position = pos_x is not None and pos_y is not None
    return {
        "slot": slot,
        "name": getattr(player, "civilization", None) or "Unknown",
        "objectCount": object_count,
        "hasStartPosition": has_start_position,
        "startPosition": (
            {"x": int(pos_x), "y": int(pos_y)}
            if has_start_position
            else None
        ),
        "occupied": object_count > 0 or has_start_position,
    }


def analyse_scenario(file_bytes, *, name: str = "uploaded scenario"):
    parsed = parse_scenario_any(file_bytes, name=name)
    match = match_from_parsed_scenario(parsed)
    players = [
        _player_summary(player, slot)
        for slot, player in enumerate(match.players, start=1)
    ]
    summary = {
        "edition": parsed.edition.value,
        "containerFormat": parsed.detection.container_format,
        "dataVersion": parsed.detection.data_version,
        "isDefinitiveEdition": parsed.is_definitive_edition,
        "detectionReason": parsed.detection.reason,
        "parseBackend": (
            "AoE2DEScenario"
            if parsed.is_definitive_edition
            else "aoe2_mcgeniescx.Scenario"
        ),
        "mapDimension": int(match.map.dimension),
        "tileCount": len(match.map.tiles),
        "playerSlots": len(players),
        "activePlayerCount": sum(1 for player in players if player["occupied"]),
        "playerObjectCount": sum(player["objectCount"] for player in players),
        "gaiaObjectCount": len(match.gaia),
        "players": players,
    }
    return summary, match
