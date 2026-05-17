#!/usr/bin/env python3
"""
One-off full parse + D1/R2 write for DE scenarios that need museum AoE2ScenarioParser
(variable trigger property counts). Uses sourcemodules parser only (not Forks/).

  python scripts/backfill-de-coop-once.py
  python scripts/backfill-de-coop-once.py --dry-run
"""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
SCRIPTS = REPO / "scripts"

# Museum parser only — do not prepend Forks/AoE2ScenarioParser.
for p in (
    REPO / "sourcemodules" / "AoE2ScenarioParser",
    REPO / "sourcemodules" / "aoe2mcminimap",
    REPO / "sourcemodules",
    SCRIPTS,
):
    s = str(p)
    if p.is_dir() and s not in sys.path:
        sys.path.insert(0, s)

DE_COOP_IDS = (
    3376,  # Tariq 1 (CO-OP)
    3384,  # Tariq 5 (CO-OP)
    3401,  # Alaric 4
    3442,  # BotC Tours (CO-OP)
    3503,  # Kotyan 3
    3548,  # Suryavarman 3 (CO-OP)
    3550,  # Suryavarman 4 (CO-OP)
    3554,  # Tamerlane 1 (CO-OP)
    3556,  # Tamerlane 2 (CO-OP)
)


def _load_backfill():
    spec = importlib.util.spec_from_file_location(
        "backfill_scenario_metadata",
        SCRIPTS / "backfill-scenario-metadata.py",
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--ids",
        type=int,
        nargs="*",
        metavar="ID",
        help="Subset of DE_COOP_IDS (default: all)",
    )
    args = parser.parse_args()
    ids = tuple(args.ids) if args.ids else DE_COOP_IDS

    bf = _load_backfill()
    import AoE2ScenarioParser

    parser_root = Path(AoE2ScenarioParser.__file__).resolve().parent
    museum_parser = (REPO / "sourcemodules" / "AoE2ScenarioParser").resolve()
    if parser_root != museum_parser:
        print(f"ERROR: expected museum parser at {museum_parser}", file=sys.stderr)
        print(f"       but loaded {parser_root}", file=sys.stderr)
        return 2

    print(f"parser: {AoE2ScenarioParser.__file__}")
    print(f"wrangler: {bf.wrangler_target_label()}")
    if os.environ.get("WRANGLER_D1_LOCAL") == "1":
        print("WARNING: WRANGLER_D1_LOCAL=1 — writing local D1/R2, not production.", file=sys.stderr)

    root = bf.museum_root()
    failures: list[dict] = []
    ok = 0

    for index, sid in enumerate(ids, start=1):
        rows = bf.d1_query(root, f"SELECT id, r2_key, original_filename, filename FROM scenarios WHERE id = {int(sid)}")
        if not rows:
            print(f"[{index}/{len(ids)}] SKIP id={sid} — not in D1")
            failures.append({"id": sid, "error": "not in D1"})
            continue
        row = rows[0]
        try:
            bf.process_one(root, row, dry_run=args.dry_run, local_root=None, columns=None)
            ok += 1
            print(f"[{index}/{len(ids)}] OK id={sid} {row.get('r2_key')}")
        except Exception as exc:
            err = str(exc).replace("\n", " ")[:500]
            failures.append({"id": sid, "r2_key": row.get("r2_key"), "error": err})
            print(f"[{index}/{len(ids)}] FAIL id={sid}: {err}")

    print(f"\nDone: {ok}/{len(ids)} ok, {len(failures)} failed")
    if failures:
        for f in failures:
            print(f"  - {f.get('id')}: {f.get('error')}")
        return 1
    return 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUTF8", "1")
    raise SystemExit(main())
