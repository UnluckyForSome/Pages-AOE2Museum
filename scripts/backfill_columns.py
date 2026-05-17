"""Column registry for selective backfill (scripts/backfill-scenario-metadata.py)."""

from __future__ import annotations

# Flattened scenario columns written by analysis_to_columns() / parse path.
PARSE_COLUMNS: frozenset[str] = frozenset(
    {
        "edition",
        "container_format",
        "data_version",
        "is_definitive_edition",
        "game_era",
        "detection_reason",
        "parse_backend",
        "game_version",
        "scenario_version",
        "map_dimension",
        "tile_count",
        "player_slots",
        "active_player_count",
        "player_object_count",
        "gaia_object_count",
        "trigger_count",
        "scenario_title",
        "scenario_instructions",
        "scenario_hints",
        "scenario_scout",
        "players_json",
    }
)

META_COLUMNS: frozenset[str] = frozenset(
    {
        "analysis_json",
        "minimap_r2_key",
        "parsed_at",
        "parser_version",
    }
)

# Can be recomputed in D1 without reading R2 / parsing the scenario bytes.
SQL_DERIVED_COLUMNS: frozenset[str] = frozenset({"game_era"})
SQL_ROUND_COLUMNS: frozenset[str] = frozenset({"data_version"})
FILENAME_DERIVED_COLUMNS: frozenset[str] = frozenset({"scenario_title"})

ALL_COLUMN_NAMES: tuple[str, ...] = tuple(sorted(PARSE_COLUMNS | META_COLUMNS))

FULL_COLUMNS: frozenset[str] = PARSE_COLUMNS | META_COLUMNS


def normalize_selected_columns(raw: list[str] | None) -> frozenset[str] | None:
    """None means full backfill (all columns)."""
    if not raw:
        return None
    out: set[str] = set()
    for item in raw:
        for part in item.split(","):
            name = part.strip()
            if not name:
                continue
            if name not in FULL_COLUMNS:
                raise ValueError(f"unknown column {name!r}; valid: {', '.join(ALL_COLUMN_NAMES)}")
            out.add(name)
    if not out:
        return None
    return frozenset(out)


def can_bulk_sql_only(columns: frozenset[str]) -> bool:
    return columns <= SQL_DERIVED_COLUMNS


def can_bulk_round_data_version(columns: frozenset[str]) -> bool:
    return columns <= SQL_ROUND_COLUMNS


def can_bulk_filename_only(columns: frozenset[str]) -> bool:
    return columns <= FILENAME_DERIVED_COLUMNS


def needs_parse(columns: frozenset[str] | None) -> bool:
    if columns is None:
        return True
    return bool(columns & (PARSE_COLUMNS | META_COLUMNS))


def needs_minimap_upload(columns: frozenset[str] | None) -> bool:
    if columns is None:
        return True
    return "minimap_r2_key" in columns


def column_flag_dest(name: str) -> str:
    return f"column_{name}"


def add_column_cli_flags(parser) -> None:
    group = parser.add_argument_group(
        "Column selection (default: full parse and write all metadata + minimap)",
    )
    group.add_argument(
        "--columns",
        dest="selected_columns",
        action="append",
        metavar="COL",
        help="Comma-separated D1 column name(s); repeat for multiple groups",
    )
    for name in ALL_COLUMN_NAMES:
        group.add_argument(
            f"--column-{name.replace('_', '-')}",
            dest="selected_columns",
            action="append_const",
            const=name,
            help=f"Update only {name}",
        )
