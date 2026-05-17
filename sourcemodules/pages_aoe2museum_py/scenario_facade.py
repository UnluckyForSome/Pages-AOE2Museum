from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path

from AoE2ScenarioParser.scenario_detection import detect_scenario_edition
from AoE2ScenarioParser.scenario_parsing import parse_scenario
from aoe2_mcminimap import MinimapSettings, match_from_parsed_scenario, to_image_from_match

# Stored scenario minimaps (R2 / Pyodide dev-parse / backfill).
MUSEUM_MINIMAP_SIZE = (560, 280)
MUSEUM_MINIMAP_WEBP_QUALITY = 82


def _coerce_bytes(file_bytes) -> bytes:
    if hasattr(file_bytes, "to_py"):
        return bytes(file_bytes.to_py())
    return bytes(file_bytes)


def _detection_summary(detection):
    return {
        "edition": detection.edition.value,
        "containerFormat": detection.container_format,
        "dataVersion": detection.data_version,
        "isDefinitiveEdition": detection.is_definitive_edition,
        "reason": detection.reason,
    }


def _parsed_summary(parsed):
    return {
        "edition": parsed.edition.value,
        "containerFormat": parsed.container_format,
        "dataVersion": parsed.data_version,
        "isDefinitiveEdition": parsed.is_definitive_edition,
        "detectionReason": parsed.detection_reason,
        "parseBackend": parsed.parse_backend,
        "gameVersion": parsed.game_version,
        "scenarioVersion": parsed.scenario_version,
    }


def detect_scenario_details(file_bytes):
    return _detection_summary(detect_scenario_edition(_coerce_bytes(file_bytes)))


def parse_scenario_any(file_bytes, *, name: str = "uploaded scenario"):
    return parse_scenario(_coerce_bytes(file_bytes), name=name, suppress_output=True)


def parse_scenario_to_match(file_bytes, *, name: str = "uploaded scenario"):
    return match_from_parsed_scenario(parse_scenario_any(file_bytes, name=name))


_SCENARIO_EXTENSIONS = (".aoe2scenario", ".aoescn", ".scx", ".scn")


def title_from_filename(name: str | None) -> str | None:
    """Display title = uploaded filename stem (no scenario extension)."""
    if not isinstance(name, str):
        return None
    base = name.strip().replace("\\", "/").rsplit("/", 1)[-1]
    if not base:
        return None
    lower = base.lower()
    for ext in _SCENARIO_EXTENSIONS:
        if lower.endswith(ext):
            stem = base[: -len(ext)].strip()
            return stem or None
    dot = base.rfind(".")
    stem = base[:dot].strip() if dot > 0 else base.strip()
    return stem or None


def _scenario_inner(parsed):
    """AoE2ScenarioParser.parse_scenario returns ParsedScenario(scenario=...)."""
    inner = getattr(parsed, "scenario", None)
    return inner if inner is not None else parsed


def _norm_str(val) -> str | None:
    if not isinstance(val, str):
        return None
    t = val.strip()
    return t if t else None


def _legacy_rge_base(root):
    try:
        fmt = getattr(root, "format", None)
        if fmt is None:
            return None
        tribe = getattr(fmt, "tribe_scen", None)
        if tribe is None:
            return None
        return getattr(tribe, "base", None)
    except Exception:
        return None


def _trigger_count(parsed) -> int | None:
    try:
        root = _scenario_inner(parsed)
        tm = getattr(root, "trigger_manager", None)
        if tm is not None:
            return int(len(tm.triggers))
        triggers_fn = getattr(root, "triggers", None)
        if callable(triggers_fn):
            ts = triggers_fn()
            if ts is not None:
                return int(len(ts.triggers))
            # genie-scx: container < 1.14 has no TriggerSystem in the file (AoE1-era).
            return 0
        return None
    except Exception:
        return None


def _objectives_from_scenario(parsed):
    """Instructions / Hints / Scout — DE Message tab or legacy RGEScen fields."""
    try:
        root = _scenario_inner(parsed)

        def pack(instructions, hints, scout):
            out = {
                "instructions": _norm_str(instructions),
                "hints": _norm_str(hints),
                "scout": _norm_str(scout),
            }
            return out if any(out.values()) else None

        mm = getattr(root, "message_manager", None)
        if mm is not None:
            return pack(
                getattr(mm, "instructions", None),
                getattr(mm, "hints", None),
                getattr(mm, "scouts", None),
            )

        base = _legacy_rge_base(root)
        if base is not None:
            desc_fn = getattr(root, "description", None)
            instructions = desc_fn() if callable(desc_fn) else getattr(base, "description", None)
            return pack(
                instructions,
                getattr(base, "hints", None),
                getattr(base, "scout", None),
            )
        return None
    except Exception:
        return None


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


def museum_minimap_settings() -> MinimapSettings:
    """McMinimap settings for archive scenario previews (fixed size, WEBP export)."""
    return MinimapSettings(final_size=MUSEUM_MINIMAP_SIZE)


def scenario_minimap_r2_key(scenario_id: int | str) -> str:
    return f"scenario/{scenario_id}.webp"


def to_museum_minimap_webp_bytes_from_match(match, *, settings: MinimapSettings | None = None) -> bytes:
    """Render match to compressed WEBP at ``MUSEUM_MINIMAP_SIZE``."""
    cfg = settings or museum_minimap_settings()
    img = to_image_from_match(match, settings=cfg)
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=MUSEUM_MINIMAP_WEBP_QUALITY, method=4)
    return buf.getvalue()


def build_analysis_summary(parsed, match, *, fallback_title: str | None = None) -> dict:
    """JSON-safe analysis dict for DB/API (Pyodide bootstrap + museum)."""
    players = [
        _player_summary(player, slot)
        for slot, player in enumerate(match.players, start=1)
    ]
    title = title_from_filename(fallback_title)
    summary = {
        **_parsed_summary(parsed),
        "mapDimension": int(match.map.dimension),
        "tileCount": len(match.map.tiles),
        "playerSlots": len(players),
        "activePlayerCount": sum(1 for player in players if player["occupied"]),
        "playerObjectCount": sum(player["objectCount"] for player in players),
        "gaiaObjectCount": len(match.gaia),
        "triggerCount": _trigger_count(parsed),
        "scenarioTitle": title,
        "players": players,
    }
    objectives = _objectives_from_scenario(parsed)
    if objectives:
        summary["objectives"] = objectives
    return summary


def analyse_scenario(file_bytes, *, name: str = "uploaded scenario"):
    parsed = parse_scenario_any(file_bytes, name=name)
    match = match_from_parsed_scenario(parsed)
    summary = build_analysis_summary(parsed, match, fallback_title=name)
    return summary, match


def _scenario_suffix(name: str) -> str:
    lower = (name or "").lower().replace("\\", "/").rsplit("/", 1)[-1]
    for ext in _SCENARIO_EXTENSIONS:
        if lower.endswith(ext):
            return ext
    dot = lower.rfind(".")
    return lower[dot:] if dot > 0 else ".scx"


def convert_legacy_scenario_to_de_bytes(file_bytes, *, name: str = "scenario") -> bytes:
    """Legacy/HD container → rebuilt Definitive Edition ``.aoe2scenario`` bytes."""
    from AoE2ScenarioParser.legacy_bridge.bridge_wireup import convert_legacy_to_de

    data = _coerce_bytes(file_bytes)
    suffix = _scenario_suffix(name)
    inp_path = None
    out_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as inp:
            inp.write(data)
            inp.flush()
            inp_path = inp.name
        out_path = inp_path + ".de.aoe2scenario"
        convert_legacy_to_de(inp_path, out_path)
        return Path(out_path).read_bytes()
    finally:
        for path in (inp_path, out_path):
            if not path:
                continue
            try:
                os.remove(path)
            except OSError:
                pass
