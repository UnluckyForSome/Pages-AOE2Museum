#!/usr/bin/env python3
"""
Bulk re-parse scenarios from R2 and write flattened D1 columns + minimap PNG.

Requires: Python 3.11+, wrangler CLI, fetched/bundled parser deps on PYTHONPATH.

Environment:
  MUSEUM_ROOT          — repo root (default: parent of scripts/)
  WRANGLER_D1_LOCAL    — set to 1 for --local D1/R2 only (default: remote production)
                       Unset this before a production backfill or you will update local D1/R2.
  PYLIBS_PATH          — extra sys.path entries (colon/semicolon separated)

Typical setup (from Pages-AOE2Museum after npm run fetch:pylibs):
  python scripts/backfill-scenario-metadata.py --dry-run --limit 5

Flags:
  --dry-run            Print actions only; no R2/D1 writes
  --limit N            Process at most N scenarios
  --after-id ID        Resume after this scenario id
  --only-unparsed      Rows with parsed_at IS NULL
  --only-stale         Rows where parser_version != current
  --only-null          With --columns, only rows where those column(s) are NULL
  --force              Overwrite non-NULL values (game_era bulk: NULL only unless --force)
  --columns scenario_title  Fast path: set title from filename for all rows (no R2 parse)
  --id ID              Single scenario id
  --local-root DIR     If DIR/<r2_key> exists as a file, read bytes from disk instead of R2 get

Column selection (default: full parse + all columns + minimap):
  --columns COL        Comma-separated D1 column name(s); repeat flag for more
  --column-game-era    Example per-column flag; one flag per flattened/meta column

Examples:
  python scripts/backfill-scenario-metadata.py --columns game_era
  python scripts/backfill-scenario-metadata.py --column-scenario-title --only-stale --limit 50
  python scripts/backfill-scenario-metadata.py --columns game_era,scenario_title --id 42
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from backfill_columns import (
    META_COLUMNS,
    PARSE_COLUMNS,
    add_column_cli_flags,
    can_bulk_filename_only,
    can_bulk_round_data_version,
    can_bulk_sql_only,
    needs_minimap_upload,
    normalize_selected_columns,
)
from game_era import GAME_ERA_D1_CASE, derive_game_era
from stage_log import stage, stage_done

PARSER_VERSION = "pyodide-mcminimap-v7"
BACKFILL_STAGES = 2
SCENARIOS_BUCKET = "scenarios"
MINIMAPS_BUCKET = "aoe2museum-minimaps"
D1_DATABASE = "scenarios"


def museum_root() -> Path:
    env = os.environ.get("MUSEUM_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[1]


def setup_pythonpath(root: Path) -> None:
    # Last entry inserted wins (insert(0)); museum vendored parser must beat Forks/.
    candidates = [
        root.parent.parent / "Forks" / "AoE2ScenarioParser",
        root.parent.parent / "Public" / "AOE2-McGenieSCX",
        root / "sourcemodules",
        root / "sourcemodules" / "aoe2mcminimap",
        root / "sourcemodules" / "AoE2ScenarioParser",
    ]
    extra = os.environ.get("PYLIBS_PATH", "")
    if extra:
        candidates.extend(Path(p) for p in extra.split(os.pathsep) if p.strip())
    for path in candidates:
        if path.is_dir() and str(path) not in sys.path:
            sys.path.insert(0, str(path))


setup_pythonpath(museum_root())

from pages_aoe2museum_py.scenario_facade import title_from_filename  # noqa: E402


def wrangler_flag(root: Path) -> list[str]:
    return ["--local"] if os.environ.get("WRANGLER_D1_LOCAL") == "1" else ["--remote"]


def _wrangler_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    # Wrangler progress bars use Unicode; avoid cp1252 decode failures on Windows.
    env.setdefault("PYTHONUTF8", "1")
    return env


def wrangler_target_label() -> str:
    return "local" if os.environ.get("WRANGLER_D1_LOCAL") == "1" else "remote"


def _wrangler_argv(root: Path, *args: str) -> list[str]:
    """Resolve wrangler CLI without shell=True (npx is npx.cmd on Windows)."""
    bin_dir = root / "node_modules" / ".bin"
    if os.name == "nt":
        local = bin_dir / "wrangler.cmd"
        if local.is_file():
            return [str(local), *args, *wrangler_flag(root)]
        return ["npx.cmd", "wrangler", *args, *wrangler_flag(root)]
    local = bin_dir / "wrangler"
    if local.is_file():
        return [str(local), *args, *wrangler_flag(root)]
    return ["npx", "wrangler", *args, *wrangler_flag(root)]


def run_wrangler(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    cmd = _wrangler_argv(root, *args)
    return subprocess.run(
        cmd,
        cwd=str(root),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=_wrangler_env(),
        shell=False,
        check=False,
    )


def _wrangler_combined_output(proc: subprocess.CompletedProcess[str]) -> str:
    parts: list[str] = []
    if proc.stdout:
        parts.append(proc.stdout)
    if proc.stderr:
        parts.append(proc.stderr)
    return "\n".join(parts).strip()


def _parse_wrangler_json(proc: subprocess.CompletedProcess[str]):
    text = _wrangler_combined_output(proc)
    if not text:
        raise RuntimeError("wrangler produced no output")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise RuntimeError(f"could not parse wrangler JSON: {text[:500]}") from None


def d1_query(root: Path, sql: str) -> list[dict]:
    proc = run_wrangler(
        root,
        "d1",
        "execute",
        D1_DATABASE,
        "--command",
        sql,
        "--json",
    )
    if proc.returncode != 0:
        raise RuntimeError(_wrangler_combined_output(proc) or "d1 execute failed")
    payload = _parse_wrangler_json(proc)
    if not payload or not payload[0].get("success"):
        raise RuntimeError(f"d1 query failed: {_wrangler_combined_output(proc)}")
    return payload[0].get("results") or []


def d1_execute(root: Path, sql: str) -> None:
    """Run SQL via a temp file — avoids Windows shell mangling long text literals."""
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            suffix=".sql",
            delete=False,
            newline="\n",
        ) as tmp:
            tmp.write(sql)
            tmp_path = tmp.name
        proc = run_wrangler(
            root,
            "d1",
            "execute",
            D1_DATABASE,
            f"--file={tmp_path}",
        )
        if proc.returncode != 0:
            raise RuntimeError(_wrangler_combined_output(proc) or "d1 execute failed")
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def sql_quote(val) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        return str(val)
    s = str(val).replace("\x00", "").replace("'", "''")
    return f"'{s}'"


def r2_get(root: Path, bucket: str, key: str, dest: Path) -> None:
    proc = run_wrangler(
        root,
        "r2",
        "object",
        "get",
        f"{bucket}/{key}",
        "--file",
        str(dest),
    )
    if proc.returncode != 0:
        raise RuntimeError(f"r2 get {bucket}/{key}: {_wrangler_combined_output(proc)}")


def r2_put(root: Path, bucket: str, key: str, src: Path) -> None:
    proc = run_wrangler(
        root,
        "r2",
        "object",
        "put",
        f"{bucket}/{key}",
        "--file",
        str(src),
        "--content-type",
        "image/webp" if str(src).endswith(".webp") else "image/png",
    )
    if proc.returncode != 0:
        raise RuntimeError(f"r2 put {bucket}/{key}: {_wrangler_combined_output(proc)}")


def minimap_key(scenario_id: int) -> str:
    from pages_aoe2museum_py.scenario_facade import scenario_minimap_r2_key

    return scenario_minimap_r2_key(scenario_id)


def local_scenario_file(local_root: Path | None, r2_key: str) -> Path | None:
    """Return a readable file path under local_root matching r2_key, or None."""
    if local_root is None:
        return None
    key = str(r2_key).strip().replace("\\", "/").lstrip("/")
    parts = [p for p in key.split("/") if p and p != "."]
    if not parts or any(p == ".." for p in parts):
        return None
    candidate = local_root.resolve().joinpath(*parts)
    try:
        candidate.relative_to(local_root.resolve())
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def build_update_sql(scenario_id: int, fields: dict) -> str:
    if not fields:
        raise ValueError("no columns to update")
    sets = ", ".join(f"{k} = {sql_quote(v)}" for k, v in fields.items())
    return f"UPDATE scenarios SET {sets} WHERE id = {scenario_id}"


def null_filter_sql(columns: frozenset[str]) -> str:
    parts = [f"({col} IS NULL)" for col in sorted(columns)]
    return " AND ".join(parts)


def build_where_clause(
    args: argparse.Namespace,
    columns: frozenset[str] | None,
    *,
    bulk: bool = False,
) -> str:
    clauses: list[str] = []
    if args.id is not None:
        clauses.append(f"id = {int(args.id)}")
    elif args.only_unparsed:
        clauses.append("parsed_at IS NULL")
    elif args.only_stale:
        clauses.append(
            f"(parser_version IS NULL OR parser_version != {sql_quote(PARSER_VERSION)})"
        )
    elif not bulk:
        clauses.append(
            f"(parsed_at IS NULL OR parser_version IS NULL "
            f"OR parser_version != {sql_quote(PARSER_VERSION)})"
        )

    if (
        bulk
        and columns == frozenset({"game_era"})
        and not args.force
        and not args.only_unparsed
        and not args.only_stale
        and args.id is None
        and not args.only_null
    ):
        clauses.append("(game_era IS NULL OR game_era = '')")

    if (
        bulk
        and columns == frozenset({"scenario_title"})
        and not args.force
        and not args.only_unparsed
        and not args.only_stale
        and args.id is None
        and not args.only_null
    ):
        # Default: refresh every row from filename (no full re-parse).
        pass

    if args.only_null and columns:
        clauses.append(null_filter_sql(columns))

    if args.after_id is not None:
        clauses.append(f"id > {int(args.after_id)}")

    if not clauses:
        return ""
    return " WHERE " + " AND ".join(clauses)


def analysis_to_columns(analysis: dict) -> dict:
    objectives = analysis.get("objectives") or {}
    if not isinstance(objectives, dict):
        objectives = {}

    def obj_text(key: str):
        v = objectives.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
        return None

    players = analysis.get("players")
    players_json = json.dumps(players) if isinstance(players, list) else None

    def s(key):
        v = analysis.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
        return None

    def i(key):
        v = analysis.get(key)
        if v is None:
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    def r(key):
        v = analysis.get(key)
        if v is None:
            return None
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
        if key == "dataVersion":
            return round(n, 2)
        return n

    ide = analysis.get("isDefinitiveEdition")
    is_de = None
    if ide is True:
        is_de = 1
    elif ide is False:
        is_de = 0

    edition = s("edition")
    container_format = s("containerFormat")
    data_version = r("dataVersion")
    return {
        "edition": edition,
        "container_format": container_format,
        "data_version": data_version,
        "is_definitive_edition": is_de,
        "game_era": derive_game_era(
            container_format=container_format,
            data_version=data_version,
            is_definitive_edition=is_de,
        ),
        "detection_reason": s("detectionReason"),
        "parse_backend": s("parseBackend"),
        "game_version": s("gameVersion"),
        "scenario_version": s("scenarioVersion"),
        "map_dimension": i("mapDimension"),
        "tile_count": i("tileCount"),
        "player_slots": i("playerSlots"),
        "active_player_count": i("activePlayerCount"),
        "player_object_count": i("playerObjectCount"),
        "gaia_object_count": i("gaiaObjectCount"),
        "trigger_count": i("triggerCount"),
        "scenario_title": s("scenarioTitle"),
        "scenario_instructions": obj_text("instructions"),
        "scenario_hints": obj_text("hints"),
        "scenario_scout": obj_text("scout"),
        "players_json": players_json,
    }


def fetch_rows(
    root: Path,
    args: argparse.Namespace,
    columns: frozenset[str] | None,
) -> list[dict]:
    where = build_where_clause(args, columns, bulk=False)
    limit = f" LIMIT {int(args.limit)}" if args.limit else ""
    sql = (
        "SELECT id, r2_key, original_filename, filename "
        f"FROM scenarios{where} ORDER BY id ASC{limit}"
    )
    return d1_query(root, sql)


def collect_update_fields(
    summary: dict,
    scenario_id: int,
    parsed_at: str,
    columns: frozenset[str] | None,
) -> dict:
    cols = analysis_to_columns(summary)
    analysis_json = json.dumps(summary, ensure_ascii=False)
    minimap = minimap_key(scenario_id)
    all_fields = {
        "analysis_json": analysis_json,
        "minimap_r2_key": minimap,
        "parsed_at": parsed_at,
        "parser_version": PARSER_VERSION,
        **cols,
    }
    if columns is None:
        return all_fields
    return {k: v for k, v in all_fields.items() if k in columns}


def bulk_update_scenario_title(
    root: Path,
    args: argparse.Namespace,
    dry_run: bool,
) -> int:
    columns = frozenset({"scenario_title"})
    where = build_where_clause(args, columns, bulk=True)
    limit = f" LIMIT {int(args.limit)}" if args.limit else ""
    sql = (
        "SELECT id, original_filename, filename "
        f"FROM scenarios{where} ORDER BY id ASC{limit}"
    )
    rows = d1_query(root, sql)
    updated = 0
    for row in rows:
        sid = int(row["id"])
        name = (
            str(row.get("original_filename") or "").strip()
            or str(row.get("filename") or "").strip()
        )
        title = title_from_filename(name)
        if not title:
            continue
        if dry_run:
            updated += 1
            continue
        d1_execute(
            root,
            f"UPDATE scenarios SET scenario_title = {sql_quote(title)} WHERE id = {sid}",
        )
        updated += 1
    if dry_run:
        print(f"    dry-run: would SET scenario_title on {updated} row(s)")
    else:
        print(f"    updated scenario_title on {updated} row(s)")
    return updated


def bulk_update_data_version(
    root: Path,
    args: argparse.Namespace,
    dry_run: bool,
) -> int:
    where_parts = ["data_version IS NOT NULL"]
    if args.only_null:
        pass  # already non-null only
    if args.id is not None:
        where_parts.append(f"id = {int(args.id)}")
    if args.after_id is not None:
        where_parts.append(f"id > {int(args.after_id)}")
    where = f" WHERE {' AND '.join(where_parts)}"
    if args.limit:
        sub = f"SELECT id FROM scenarios{where} ORDER BY id ASC LIMIT {int(args.limit)}"
        update_sql = (
            f"UPDATE scenarios SET data_version = ROUND(data_version, 2) "
            f"WHERE id IN ({sub})"
        )
        count_sql = f"SELECT COUNT(*) AS c FROM ({sub})"
    else:
        update_sql = f"UPDATE scenarios SET data_version = ROUND(data_version, 2){where}"
        count_sql = f"SELECT COUNT(*) AS c FROM scenarios{where}"

    rows = d1_query(root, count_sql)
    count = int(rows[0].get("c") or 0) if rows else 0
    if dry_run:
        print(f"    dry-run: would ROUND(data_version, 2) on {count} row(s)")
        return count
    d1_execute(root, update_sql)
    print(f"    rounded data_version on {count} row(s)")
    return count


def bulk_update_game_era(
    root: Path,
    args: argparse.Namespace,
    columns: frozenset[str],
    dry_run: bool,
) -> int:
    where = build_where_clause(args, columns, bulk=True)
    if args.limit:
        sub = (
            f"SELECT id FROM scenarios{where} ORDER BY id ASC LIMIT {int(args.limit)}"
        )
        update_sql = (
            f"UPDATE scenarios SET game_era = {GAME_ERA_D1_CASE} "
            f"WHERE id IN ({sub})"
        )
        count_sql = f"SELECT COUNT(*) AS c FROM ({sub})"
    else:
        update_sql = f"UPDATE scenarios SET game_era = {GAME_ERA_D1_CASE}{where}"
        count_sql = f"SELECT COUNT(*) AS c FROM scenarios{where}"

    rows = d1_query(root, count_sql)
    count = int(rows[0].get("c") or 0) if rows else 0
    if dry_run:
        print(f"    dry-run: would SET game_era on {count} row(s)")
        return count
    d1_execute(root, update_sql)
    print(f"    updated game_era on {count} row(s)")
    return count


def process_one(
    root: Path,
    row: dict,
    dry_run: bool,
    local_root: Path | None = None,
    *,
    columns: frozenset[str] | None = None,
) -> None:
    from datetime import datetime, timezone

    from aoe2_mcminimap import match_from_parsed_scenario
    from pages_aoe2museum_py.scenario_facade import (
        build_analysis_summary,
        parse_scenario_any,
        to_museum_minimap_webp_bytes_from_match,
    )

    sid = int(row["id"])
    r2_key = row["r2_key"]
    name = row.get("original_filename") or row.get("filename") or f"scenario-{sid}"

    local_file = local_scenario_file(local_root, r2_key)
    if dry_run:
        return

    with tempfile.TemporaryDirectory() as tmp:
        scen_path = Path(tmp) / "scenario.bin"
        webp_path = Path(tmp) / "minimap.webp"
        if local_file is not None:
            data = local_file.read_bytes()
        else:
            r2_get(root, SCENARIOS_BUCKET, r2_key, scen_path)
            data = scen_path.read_bytes()
        parsed = parse_scenario_any(data, name=name)
        match = match_from_parsed_scenario(parsed)
        summary = build_analysis_summary(parsed, match, fallback_title=name)
        if needs_minimap_upload(columns):
            webp_path.write_bytes(to_museum_minimap_webp_bytes_from_match(match))
            r2_put(root, MINIMAPS_BUCKET, minimap_key(sid), webp_path)

    parsed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
    fields = collect_update_fields(summary, sid, parsed_at, columns)
    if columns and not (columns & (PARSE_COLUMNS | META_COLUMNS)):
        raise ValueError(f"no writable columns in selection: {sorted(columns)}")
    touch_meta = columns is None or bool(columns & (PARSE_COLUMNS | {"analysis_json"}))
    if touch_meta and (columns is None or "parsed_at" in columns):
        fields.setdefault("parsed_at", parsed_at)
    if touch_meta and (columns is None or "parser_version" in columns):
        fields.setdefault("parser_version", PARSER_VERSION)
    sql = build_update_sql(sid, fields)
    d1_execute(root, sql)


def _row_display_name(row: dict) -> str:
    return (
        str(row.get("original_filename") or "").strip()
        or str(row.get("filename") or "").strip()
        or str(row.get("r2_key") or "").strip()
        or f"scenario-{row.get('id')}"
    )


def _write_failures_out(path: Path, failures: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not failures:
        if path.is_file():
            path.unlink()
        return
    with path.open("w", encoding="utf-8", newline="\n") as fh:
        for item in failures:
            line = "\t".join(
                [
                    item["display"],
                    item.get("r2_key") or "",
                    str(item.get("id") or ""),
                    item.get("error") or "",
                ]
            )
            fh.write(line + "\n")


def _print_failure_summary(failures: list[dict]) -> None:
    if not failures:
        return
    print("", flush=True)
    print(f"[BACKFILL] Parse failures ({len(failures)}):", file=sys.stderr, flush=True)
    for item in failures:
        sid = item.get("id")
        key = item.get("r2_key") or ""
        err = (item.get("error") or "").replace("\n", " ")
        print(f"  - {item['display']}", file=sys.stderr, flush=True)
        if sid is not None:
            print(f"      id={sid}", file=sys.stderr, flush=True)
        if key:
            print(f"      key={key}", file=sys.stderr, flush=True)
        if err:
            print(f"      {err[:500]}", file=sys.stderr, flush=True)
    print("", flush=True)


def _log_progress(
    done: int,
    total: int,
    *,
    status: str,
    scenario_id: int | None = None,
    detail: str = "",
) -> None:
    prefix = f"[{done}/{total}]"
    parts = [prefix, status]
    if scenario_id is not None:
        parts.append(f"id={scenario_id}")
    if detail:
        parts.append(detail)
    line = " ".join(parts)
    stream = sys.stderr if status == "FAIL" else sys.stdout
    print(line, file=stream, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--after-id", type=int, default=None)
    parser.add_argument("--only-unparsed", action="store_true")
    parser.add_argument("--only-stale", action="store_true")
    parser.add_argument("--id", type=int, default=None)
    parser.add_argument(
        "--local-root",
        type=str,
        default=None,
        metavar="DIR",
        help="If DIR/<r2_key> exists as a file, read scenario bytes from disk instead of R2",
    )
    parser.add_argument(
        "--only-null",
        action="store_true",
        help="Only rows where the selected column(s) are NULL",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite non-NULL values (game_era-only bulk defaults to NULL rows only)",
    )
    parser.add_argument(
        "--failures-out",
        type=Path,
        default=None,
        metavar="PATH",
        help="Write parse failures as TSV (display, r2_key, id, error); removed when none",
    )
    add_column_cli_flags(parser)
    args = parser.parse_args()

    try:
        columns = normalize_selected_columns(args.selected_columns)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    root = museum_root()
    setup_pythonpath(root)

    local_root = Path(args.local_root).resolve() if args.local_root else None
    if local_root is not None and not local_root.is_dir():
        print(f"ERROR: --local-root is not a directory: {local_root}", file=sys.stderr)
        return 2

    target = wrangler_target_label()
    stage("BACKFILL", 1, BACKFILL_STAGES, "Query D1 for scenarios to process")
    print(f"    wrangler D1/R2 target: {target}")
    if target == "local":
        print(
            "    WARNING: WRANGLER_D1_LOCAL=1 — local wrangler state, not production.",
            file=sys.stderr,
        )

    col_note = f", columns={','.join(sorted(columns))}" if columns else ""
    if columns and can_bulk_filename_only(columns):
        mode = "bulk filename title"
    elif columns and can_bulk_round_data_version(columns):
        mode = "bulk ROUND data_version"
    elif columns and can_bulk_sql_only(columns):
        mode = "bulk SQL"
    else:
        mode = "parse"
    print(f"    mode: {mode}{col_note}")

    if columns and can_bulk_round_data_version(columns):
        stage_done("BACKFILL", 1, BACKFILL_STAGES, "bulk ROUND data_version (no parse)")
        stage("BACKFILL", 2, BACKFILL_STAGES, "ROUND data_version to 2 dp")
        bulk_update_data_version(root, args, dry_run=args.dry_run)
        stage_done("BACKFILL", 2, BACKFILL_STAGES, "data_version")
        print(f"[BACKFILL] All {BACKFILL_STAGES} stages complete.", flush=True)
        return 0

    if columns and can_bulk_sql_only(columns):
        stage_done("BACKFILL", 1, BACKFILL_STAGES, "bulk SQL (no per-row list)")
        stage("BACKFILL", 2, BACKFILL_STAGES, "Bulk SQL column update")
        bulk_update_game_era(root, args, columns, dry_run=args.dry_run)
        stage_done("BACKFILL", 2, BACKFILL_STAGES, "bulk game_era")
        print(f"[BACKFILL] All {BACKFILL_STAGES} stages complete.", flush=True)
        return 0

    if columns and can_bulk_filename_only(columns):
        stage_done("BACKFILL", 1, BACKFILL_STAGES, "bulk filename titles (no parse)")
        stage("BACKFILL", 2, BACKFILL_STAGES, "Set scenario_title from filename")
        bulk_update_scenario_title(root, args, dry_run=args.dry_run)
        stage_done("BACKFILL", 2, BACKFILL_STAGES, "scenario_title")
        print(f"[BACKFILL] All {BACKFILL_STAGES} stages complete.", flush=True)
        return 0

    rows = fetch_rows(root, args, columns)
    if not rows:
        print("    no scenarios matched filters")
        stage_done("BACKFILL", 1, BACKFILL_STAGES)
        return 0

    total = len(rows)
    lr_note = f", local_root={local_root}" if local_root else ""
    print(f"    matched {total} row(s) (parser_version={PARSER_VERSION}{lr_note})")
    stage_done("BACKFILL", 1, BACKFILL_STAGES, f"{total} scenario(s)")

    stage_label = "Parse scenarios"
    if columns:
        stage_label += f" (write: {','.join(sorted(columns))})"
    else:
        stage_label += " (minimap + all D1 columns)"
    stage("BACKFILL", 2, BACKFILL_STAGES, stage_label)

    failures: list[dict] = []
    failed = 0
    for index, row in enumerate(rows, start=1):
        sid = row.get("id")
        try:
            if args.dry_run:
                src = "local" if local_scenario_file(local_root, row.get("r2_key") or "") else "r2"
                process_one(
                    root,
                    row,
                    dry_run=True,
                    local_root=local_root,
                    columns=columns,
                )
                _log_progress(
                    index,
                    total,
                    status="dry-run",
                    scenario_id=int(sid) if sid is not None else None,
                    detail=f"key={row.get('r2_key')} src={src}",
                )
            else:
                process_one(
                    root,
                    row,
                    dry_run=False,
                    local_root=local_root,
                    columns=columns,
                )
                _log_progress(index, total, status="complete", scenario_id=int(sid))
        except Exception as exc:
            failed += 1
            err = str(exc).replace("\n", " ")[:500]
            failures.append(
                {
                    "display": _row_display_name(row),
                    "r2_key": row.get("r2_key"),
                    "id": sid,
                    "error": err,
                }
            )
            _log_progress(
                index,
                total,
                status="FAIL",
                scenario_id=int(sid) if sid is not None else None,
                detail=err,
            )
    ok = total - failed
    stage_done("BACKFILL", 2, BACKFILL_STAGES, f"{ok}/{total} ok, {failed} failed")
    if args.failures_out is not None:
        _write_failures_out(args.failures_out.resolve(), failures)
    _print_failure_summary(failures)
    print(f"[BACKFILL] All {BACKFILL_STAGES} stages complete.", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
