#!/usr/bin/env python3
"""Reproduce .last-backfill-failures.tsv against Forks vs museum AoE2ScenarioParser."""

from __future__ import annotations

import argparse
import importlib.util
import sys
import tempfile
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
FORKS_PARSER = REPO.parent.parent / "Forks" / "AoE2ScenarioParser"
MUSEUM_PARSER = REPO / "sourcemodules" / "AoE2ScenarioParser"
PUBLIC_GENIE = REPO.parent.parent / "Public" / "AOE2-McGenieSCX"
FAILURES_TSV = REPO / "scripts" / ".last-backfill-failures.tsv"
SCENARIOS_BUCKET = "scenarios"


def load_failures(path: Path) -> list[dict]:
    rows: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t", 3)
        while len(parts) < 4:
            parts.append("")
        rows.append(
            {
                "display": parts[0],
                "r2_key": parts[1],
                "id": parts[2],
                "backfill_error": parts[3],
            }
        )
    return rows


def prepend_sys_path(*paths: Path) -> list[str]:
    added: list[str] = []
    for path in reversed(paths):
        if path.is_dir():
            s = str(path)
            if s not in sys.path:
                sys.path.insert(0, s)
                added.append(s)
    extra = [
        REPO / "sourcemodules",
        REPO / "sourcemodules" / "aoe2mcminimap",
        PUBLIC_GENIE,
    ]
    for path in extra:
        s = str(path)
        if path.is_dir() and s not in sys.path:
            sys.path.insert(0, s)
            added.append(s)
    return added


def clear_parser_modules() -> None:
    for name in list(sys.modules):
        if name == "AoE2ScenarioParser" or name.startswith("AoE2ScenarioParser."):
            del sys.modules[name]


def parse_with_label(
    data: bytes,
    name: str,
    label: str,
    parser_root: Path,
    *,
    quiet: bool = False,
) -> dict:
    clear_parser_modules()
    prepend_sys_path(parser_root)
    from AoE2ScenarioParser.scenario_parsing import parse_scenario

    try:
        parsed = parse_scenario(data, name=name, suppress_output=quiet)
        edition = getattr(parsed, "edition", None)
        ed_val = edition.value if hasattr(edition, "value") else edition
        return {
            "ok": True,
            "label": label,
            "edition": ed_val,
            "container_format": parsed.container_format,
            "data_version": parsed.data_version,
        }
    except Exception as exc:
        return {
            "ok": False,
            "label": label,
            "error": f"{type(exc).__name__}: {exc}",
            "trace_tail": traceback.format_exc().strip().splitlines()[-4:],
        }


def minimap_with_label(data: bytes, name: str, label: str, parser_root: Path) -> dict:
    clear_parser_modules()
    prepend_sys_path(parser_root, REPO / "sourcemodules" / "aoe2mcminimap")
    from AoE2ScenarioParser.scenario_parsing import parse_scenario
    from aoe2_mcminimap import match_from_parsed_scenario

    try:
        parsed = parse_scenario(data, name=name, suppress_output=True)
        match = match_from_parsed_scenario(parsed)
        return {
            "ok": True,
            "label": label,
            "map_dimension": int(match.map.dimension),
            "players": len(match.players),
            "tiles": len(match.map.tiles),
        }
    except Exception as exc:
        return {
            "ok": False,
            "label": label,
            "error": f"{type(exc).__name__}: {exc}",
        }


def fetch_bytes(
    backfill,
    root: Path,
    r2_key: str,
    local_root: Path | None,
) -> tuple[bytes | None, str]:
    local_file = backfill.local_scenario_file(local_root, r2_key)
    if local_file is not None:
        return local_file.read_bytes(), f"local:{local_file}"
    with tempfile.TemporaryDirectory() as tmp:
        dest = Path(tmp) / "scenario.bin"
        try:
            backfill.r2_get(root, SCENARIOS_BUCKET, r2_key, dest)
            return dest.read_bytes(), f"r2:{r2_key}"
        except Exception as exc:
            return None, f"fetch failed: {exc}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--failures",
        type=Path,
        default=FAILURES_TSV,
        help="TSV from backfill --failures-out",
    )
    parser.add_argument(
        "--local-root",
        type=Path,
        default=REPO / "livescenarios",
        help="Optional local mirror for scenario bytes",
    )
    parser.add_argument("--id", type=int, default=None, help="Only diagnose this scenario id")
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress AoE2ScenarioParser status output during parse",
    )
    args = parser.parse_args()

    if not args.failures.is_file():
        print(f"Missing failures file: {args.failures}", file=sys.stderr)
        return 2
    if not FORKS_PARSER.is_dir():
        print(f"Missing Forks parser: {FORKS_PARSER}", file=sys.stderr)
        return 2

    rows = load_failures(args.failures)
    if args.id is not None:
        rows = [r for r in rows if r["id"] == str(args.id)]
    if not rows:
        print("No rows to diagnose.")
        return 0

    sys.path.insert(0, str(REPO / "scripts"))
    backfill_path = REPO / "scripts" / "backfill-scenario-metadata.py"
    spec = importlib.util.spec_from_file_location("backfill_scenario_metadata", backfill_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {backfill_path}")
    backfill = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backfill)

    root = backfill.museum_root()
    local_root = args.local_root if args.local_root.is_dir() else None

    print(f"Museum parser : {MUSEUM_PARSER}")
    print(f"Forks parser  : {FORKS_PARSER}")
    print(f"Failures      : {len(rows)} row(s)\n")

    for row in rows:
        sid = row["id"]
        name = row["display"] or row["r2_key"]
        print("=" * 72)
        print(f"id={sid}  {name}")
        print(f"backfill: {row['backfill_error']}")

        data, src = fetch_bytes(backfill, root, row["r2_key"], local_root)
        if data is None:
            print(f"  SKIP — {src}\n")
            continue
        print(f"  bytes: {len(data):,} from {src}")

        museum_parse = parse_with_label(
            data, name, "museum AoE2ScenarioParser", MUSEUM_PARSER, quiet=args.quiet
        )
        forks_parse = parse_with_label(
            data, name, "Forks AoE2ScenarioParser", FORKS_PARSER, quiet=args.quiet
        )

        for result in (museum_parse, forks_parse):
            if result["ok"]:
                print(
                    f"  OK [{result['label']}] edition={result['edition']} "
                    f"format={result['container_format']} data={result['data_version']}"
                )
            else:
                print(f"  FAIL [{result['label']}] {result['error']}")
                for line in result.get("trace_tail", []):
                    print(f"      {line}")

        same_error = (
            not museum_parse["ok"]
            and not forks_parse["ok"]
            and museum_parse.get("error") == forks_parse.get("error")
        )
        if same_error:
            print("  => Same error on museum + Forks parser (not a path mismatch).")
        elif museum_parse["ok"] != forks_parse["ok"]:
            print("  => Museum vs Forks parser differ.")

        if museum_parse["ok"]:
            mm = minimap_with_label(data, name, "minimap after museum parse", MUSEUM_PARSER)
            if mm["ok"]:
                print(
                    f"  OK [{mm['label']}] map={mm['map_dimension']} "
                    f"players={mm['players']} tiles={mm['tiles']}"
                )
            else:
                print(f"  FAIL [{mm['label']}] {mm['error']}")
                print("  => Parse succeeded but minimap/match step failed.")

        print()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
