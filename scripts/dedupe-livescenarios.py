#!/usr/bin/env python3
"""
Remove duplicate scenario files under livescenarios/ before rclone sync.

Uses MD5 of file bytes (same as website upload / scenarios.sha256 column).
Runs entirely on disk — no R2, D1, or Worker calls.

Keeps one file per hash: earliest on-disk creation time wins (path order if tied).
Extra copies are deleted (use --dry-run to preview only).
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from typing import NamedTuple

SCENARIO_EXTENSIONS = frozenset({"scn", "scx", "aoe2scenario"})


def is_scenario_file(path: Path) -> bool:
    ext = path.suffix.lstrip(".").lower()
    return ext in SCENARIO_EXTENSIONS


def file_created_at(path: Path) -> float:
    """When the file first appeared on disk (birth time, else ctime)."""
    st = path.stat()
    birth = getattr(st, "st_birthtime", None)
    if birth is not None:
        return float(birth)
    return float(st.st_ctime)


class _RankedPath(NamedTuple):
    created: float
    rel_lower: str
    path: Path


def rank_paths(root: Path, paths: list[Path]) -> list[_RankedPath]:
    ranked = [
        _RankedPath(file_created_at(p), p.relative_to(root).as_posix().lower(), p)
        for p in paths
    ]
    return sorted(ranked, key=lambda r: (r.created, r.rel_lower))


def md5_file(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def collect_scenario_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if not is_scenario_file(path):
            continue
        files.append(path)
    return files


def dedupe(root: Path, *, dry_run: bool, quiet_banner: bool = False) -> int:
    root = root.resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 1

    if not quiet_banner:
        print("    scanning files and computing MD5...")

    by_hash: dict[str, list[Path]] = {}
    for path in collect_scenario_files(root):
        digest = md5_file(path)
        by_hash.setdefault(digest, []).append(path)

    removed = 0
    groups = 0
    for digest, paths in sorted(by_hash.items()):
        if len(paths) < 2:
            continue
        groups += 1
        ranked = rank_paths(root, paths)
        keep = ranked[0].path
        keep_rel = keep.relative_to(root).as_posix()
        for entry in ranked[1:]:
            dup = entry.path
            dup_rel = dup.relative_to(root).as_posix()
            print(f"    duplicate md5={digest}")
            print(f"      keep:   {keep_rel}")
            print(f"      remove: {dup_rel}")
            if not dry_run:
                dup.unlink()
            removed += 1

    action = "would remove" if dry_run else "removed"
    print(
        f"    dedupe: {action} {removed} file(s) in {groups} duplicate group(s)",
    )
    return 0


def main() -> int:
    repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=repo / "livescenarios",
        help="livescenarios folder (default: <repo>/livescenarios)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print duplicates only; do not delete",
    )
    args = parser.parse_args()
    return dedupe(args.root, dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
