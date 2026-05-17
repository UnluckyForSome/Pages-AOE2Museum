#!/usr/bin/env python3
"""
Audit scenario rows in D1: flattened parse metadata + minimap_r2_key present in R2.

Requires: Python 3.11+, wrangler CLI (npm install in repo root).

Environment:
  MUSEUM_ROOT         — repo root (default: parent of scripts/)
  WRANGLER_D1_LOCAL   — set to 1 for local D1/R2 only; unset for production

Examples:
  python scripts/check-scenario-metadata.py
  python scripts/check-scenario-metadata.py --skip-r2
  python scripts/check-scenario-metadata.py --only-stale --failures-out scripts/.metadata-check.tsv
  python scripts/check-scenario-metadata.py --only-issues --limit 20
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from collections import Counter
from pathlib import Path

from backfill_columns import META_COLUMNS, PARSE_COLUMNS
from game_era import is_definitive_edition_container_format
from wrangler_d1 import d1_query, museum_root, run_wrangler, wrangler_target_label

PARSER_VERSION = "pyodide-mcminimap-v7"
MINIMAPS_BUCKET = "aoe2museum-minimaps"

# Written on every successful full parse; objective text may legitimately be empty.
REQUIRED_PARSE_COLUMNS = tuple(
    sorted(
        PARSE_COLUMNS
        - {
            "scenario_instructions",
            "scenario_hints",
            "scenario_scout",
        }
    )
)
REQUIRED_META_COLUMNS = tuple(sorted(META_COLUMNS))

AUDIT_SELECT = (
    "SELECT id, original_filename, filename, r2_key, "
    + ", ".join(REQUIRED_PARSE_COLUMNS)
    + ", "
    + ", ".join(REQUIRED_META_COLUMNS)
    + " FROM scenarios ORDER BY id ASC"
)


def _is_blank(val) -> bool:
    if val is None:
        return True
    if isinstance(val, str) and not val.strip():
        return True
    return False


def _row_label(row: dict) -> str:
    return (
        str(row.get("original_filename") or "").strip()
        or str(row.get("filename") or "").strip()
        or str(row.get("r2_key") or "").strip()
        or f"scenario-{row.get('id')}"
    )


def _data_version_ok(row: dict) -> bool:
    if not _is_blank(row.get("data_version")):
        return True
    cf = str(row.get("container_format") or "").strip()
    if row.get("is_definitive_edition") in (1, True):
        return True
    if cf and is_definitive_edition_container_format(cf):
        return True
    return False


def audit_row(row: dict) -> list[str]:
    issues: list[str] = []

    if _is_blank(row.get("parsed_at")):
        issues.append("unparsed")
        return issues

    pv = row.get("parser_version")
    if pv != PARSER_VERSION:
        issues.append(f"stale_parser({pv or 'null'})")

    for col in REQUIRED_META_COLUMNS:
        if _is_blank(row.get(col)):
            issues.append(f"missing_{col}")

    for col in REQUIRED_PARSE_COLUMNS:
        if col == "data_version":
            continue
        if _is_blank(row.get(col)):
            issues.append(f"missing_{col}")

    if not _data_version_ok(row):
        issues.append("missing_data_version")

    if _is_blank(row.get("game_era")):
        cf = str(row.get("container_format") or "").strip()
        dv = row.get("data_version")
        if cf or dv is not None:
            issues.append("missing_game_era")
        else:
            issues.append("missing_game_era_and_detection_fields")

    return issues


def r2_object_exists(root: Path, bucket: str, key: str) -> bool:
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        dest = tmp.name
    try:
        proc = run_wrangler(
            root,
            "r2",
            "object",
            "get",
            f"{bucket}/{key}",
            "--file",
            dest,
        )
        return proc.returncode == 0
    finally:
        try:
            os.unlink(dest)
        except OSError:
            pass


def fetch_rows(root: Path, *, only_stale: bool, only_unparsed: bool, limit: int | None) -> list[dict]:
    sql = AUDIT_SELECT
    if only_unparsed:
        sql = sql.replace(" FROM scenarios", " FROM scenarios WHERE parsed_at IS NULL", 1)
    elif only_stale:
        sql = sql.replace(
            " FROM scenarios",
            f" FROM scenarios WHERE parsed_at IS NOT NULL AND "
            f"(parser_version IS NULL OR parser_version != '{PARSER_VERSION}')",
            1,
        )
    if limit is not None:
        sql += f" LIMIT {int(limit)}"
    return d1_query(root, sql)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-r2",
        action="store_true",
        help="Only check D1 columns (fast); do not verify minimap objects in R2",
    )
    parser.add_argument(
        "--only-stale",
        action="store_true",
        help="Only rows with parsed_at set but parser_version != current",
    )
    parser.add_argument(
        "--only-unparsed",
        action="store_true",
        help="Only rows with parsed_at IS NULL",
    )
    parser.add_argument(
        "--only-issues",
        action="store_true",
        help="Print rows with at least one issue only",
    )
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument(
        "--failures-out",
        type=Path,
        default=None,
        metavar="PATH",
        help="Write TSV: display, id, r2_key, issues",
    )
    args = parser.parse_args()

    if args.only_stale and args.only_unparsed:
        print("ERROR: use --only-stale or --only-unparsed, not both", file=sys.stderr)
        return 2

    root = museum_root()
    target = wrangler_target_label()
    print(f"[CHECK] D1/R2 target: {target}")
    if target == "local":
        print("WARNING: WRANGLER_D1_LOCAL=1 — auditing local wrangler state.", file=sys.stderr)

    rows = fetch_rows(
        root,
        only_stale=args.only_stale,
        only_unparsed=args.only_unparsed,
        limit=args.limit,
    )
    total = len(rows)
    print(f"[CHECK] Scanning {total} scenario row(s) (parser_version={PARSER_VERSION})")

    issue_counts: Counter[str] = Counter()
    failures: list[dict] = []
    ok = 0

    for index, row in enumerate(rows, start=1):
        sid = int(row["id"])
        issues = audit_row(row)

        minimap_key = row.get("minimap_r2_key")
        if not args.skip_r2 and not _is_blank(minimap_key) and "missing_minimap_r2_key" not in issues:
            if not r2_object_exists(root, MINIMAPS_BUCKET, str(minimap_key).strip()):
                issues.append("minimap_missing_in_r2")

        if issues:
            for code in issues:
                issue_counts[code] += 1
            failures.append(
                {
                    "display": _row_label(row),
                    "id": sid,
                    "r2_key": row.get("r2_key"),
                    "issues": ";".join(issues),
                }
            )
            if not args.only_issues:
                print(f"  [{index}/{total}] id={sid} FAIL: {', '.join(issues)}")
        else:
            ok += 1
            if not args.only_issues:
                print(f"  [{index}/{total}] id={sid} ok")

    print("")
    print(f"[CHECK] Summary: {ok}/{total} ok, {len(failures)} with issues")
    if issue_counts:
        print("[CHECK] Issue breakdown:")
        for code, count in issue_counts.most_common():
            print(f"    {code}: {count}")

    if args.failures_out is not None:
        path = args.failures_out.resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        if failures:
            with path.open("w", encoding="utf-8", newline="\n") as fh:
                for item in failures:
                    fh.write(
                        "\t".join(
                            [
                                item["display"],
                                str(item["id"]),
                                str(item.get("r2_key") or ""),
                                item["issues"],
                            ]
                        )
                        + "\n"
                    )
            print(f"[CHECK] Wrote {len(failures)} row(s) to {path}")
        elif path.is_file():
            path.unlink()
            print(f"[CHECK] No issues — removed {path}")

    if failures:
        print("")
        print("Fix hints:")
        print("  unparsed / stale_parser / missing_*  ->  python scripts/backfill-scenario-metadata.py --only-stale")
        print("  unparsed only                        ->  python scripts/backfill-scenario-metadata.py --only-unparsed")
        print("  minimap_missing_in_r2                ->  re-run full backfill for those ids (--id N)")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
