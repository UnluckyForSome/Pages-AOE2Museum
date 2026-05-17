"""Derive game_era (aoe|aok|aoc|hd|de) from container_format + data_version — genie-scx Version."""

from __future__ import annotations

import re

AOK_FORMATS = frozenset({"1.18", "1.19", "1.20"})
AOK_MIN_CONTAINER_MINOR = 18
LEGACY_MAX_CONTAINER_MINOR = 22
DE_MIN_DATA = 1.28
AOC_MAX_DATA = 1.22
_CONTAINER_RE = re.compile(r"^1\.(\d)(\d)$")


def parse_container_format_minor(container_format: str) -> int | None:
    """Minor version from stored four-char '1.XX' string (XX as int, not float)."""
    m = _CONTAINER_RE.match(container_format.strip())
    if not m:
        return None
    return int(m.group(1)) * 10 + int(m.group(2))


def is_pre_aok_container_format(container_format: str) -> bool:
    minor = parse_container_format_minor(container_format)
    return minor is not None and minor < AOK_MIN_CONTAINER_MINOR


def is_definitive_edition_container_format(container_format: str) -> bool:
    minor = parse_container_format_minor(container_format)
    return minor is not None and minor > LEGACY_MAX_CONTAINER_MINOR


def _container_pre_aok_sql(col: str) -> str:
    return (
        f"({col} GLOB '1.[0-9][0-9]' AND "
        f"(CAST(SUBSTR({col}, 3, 1) AS INTEGER) * 10 + CAST(SUBSTR({col}, 4, 1) AS INTEGER)) "
        f"< {AOK_MIN_CONTAINER_MINOR})"
    )


def _container_de_sql(col: str) -> str:
    return (
        f"({col} GLOB '1.[0-9][0-9]' AND "
        f"(CAST(SUBSTR({col}, 3, 1) AS INTEGER) * 10 + CAST(SUBSTR({col}, 4, 1) AS INTEGER)) "
        f"> {LEGACY_MAX_CONTAINER_MINOR})"
    )


def derive_game_era(
    *,
    container_format: str | None,
    data_version: float | None,
    is_definitive_edition: bool | int | None = None,
) -> str | None:
    cf = (container_format or "").strip()
    dv = data_version
    is_de = is_definitive_edition is True or is_definitive_edition == 1

    if is_de:
        return "de"

    if dv is not None and dv >= DE_MIN_DATA:
        return "de"

    if cf and is_definitive_edition_container_format(cf):
        return "de"

    if cf in AOK_FORMATS:
        return "aok"

    if cf == "1.21" and dv is not None and dv <= AOC_MAX_DATA:
        return "aoc"

    if cf == "1.21" or (cf == "1.22" and dv is not None and dv > AOC_MAX_DATA):
        return "hd"

    if cf and is_pre_aok_container_format(cf):
        return "aoe"

    return None


# SQL CASE for UPDATE scenarios SET game_era = ... (no table alias).
GAME_ERA_D1_CASE = f"""CASE
    WHEN is_definitive_edition = 1 THEN 'de'
    WHEN data_version IS NOT NULL AND data_version >= {DE_MIN_DATA} THEN 'de'
    WHEN {_container_de_sql("container_format")} THEN 'de'
    WHEN container_format IN ('1.18', '1.19', '1.20') THEN 'aok'
    WHEN container_format = '1.21' AND data_version IS NOT NULL AND data_version <= {AOC_MAX_DATA} THEN 'aoc'
    WHEN container_format = '1.21' OR (container_format = '1.22' AND data_version IS NOT NULL AND data_version > {AOC_MAX_DATA}) THEN 'hd'
    WHEN {_container_pre_aok_sql("container_format")} THEN 'aoe'
    ELSE NULL
END"""
