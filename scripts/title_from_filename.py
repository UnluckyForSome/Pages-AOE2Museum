"""Filename stem for scenario_title (shared by backfill; mirrors scenario_facade)."""

from __future__ import annotations

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
