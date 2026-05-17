#!/usr/bin/env python3
"""
Reconcile livescenarios/ with production using D1 catalog + tombstones, then rclone.

Cloudflare cost: 2x wrangler d1 execute (catalog + tombstones) per run. Transfers via rclone only.
Worker POST /api/scenarios/sync is separate (called from sync-livescenarios.ps1).
"""

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path

from stage_log import stage, stage_done
from wrangler_d1 import d1_query, museum_root, wrangler_target_label

LABEL = "RECONCILE"
STAGES = 5

SCENARIO_EXTENSIONS = frozenset({"scn", "scx", "aoe2scenario"})


def is_scenario_key(r2_key: str) -> bool:
    ext = Path(r2_key).suffix.lstrip(".").lower()
    return ext in SCENARIO_EXTENSIONS


def local_path(root: Path, r2_key: str) -> Path:
    return root / Path(r2_key.replace("\\", "/"))


def norm_key(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def scan_local_keys(root: Path) -> set[str]:
    keys: set[str] = set()
    for path in root.rglob("*"):
        if not path.is_file() or not is_scenario_key(path.name):
            continue
        keys.add(norm_key(path, root))
    return keys


def load_catalog(root: Path) -> tuple[set[str], set[str]]:
    catalog_rows = d1_query(root, "SELECT r2_key FROM scenarios")
    tomb_rows = d1_query(root, "SELECT r2_key FROM deleted_r2_keys")

    catalog = {
        row["r2_key"]
        for row in catalog_rows
        if row.get("r2_key") and is_scenario_key(row["r2_key"])
    }
    tombstones = {row["r2_key"] for row in tomb_rows if row.get("r2_key")}
    return catalog, tombstones


def apply_tombstones(root: Path, tombstones: set[str], *, dry_run: bool) -> int:
    removed = 0
    for key in sorted(tombstones):
        path = local_path(root, key)
        if not path.is_file():
            continue
        rel = norm_key(path, root)
        print(f"    remove local: {rel}")
        if not dry_run:
            path.unlink()
        removed += 1
    return removed


def rclone_copy_files(
    remote: str,
    local_dir: Path,
    keys: list[str],
    *,
    dry_run: bool,
) -> None:
    if not keys:
        return
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        suffix=".txt",
        delete=False,
        newline="\n",
    ) as tmp:
        for key in keys:
            tmp.write(key + "\n")
        list_path = tmp.name
    try:
        print(f"    rclone copy: {len(keys)} file(s) from {remote}")
        if dry_run:
            print("    (dry-run: skipping rclone copy)")
            return
        cmd = [
            "rclone",
            "copy",
            remote,
            str(local_dir),
            "--files-from",
            list_path,
            "--progress",
        ]
        subprocess.run(cmd, check=True)
    finally:
        Path(list_path).unlink(missing_ok=True)


def rclone_sync(local_dir: Path, remote: str, *, dry_run: bool) -> None:
    print(f"    rclone sync: {local_dir} -> {remote}")
    if dry_run:
        print("    (dry-run: skipping rclone sync)")
        return
    subprocess.run(
        ["rclone", "sync", str(local_dir), remote, "--progress"],
        check=True,
    )


def run_dedupe(repo: Path, root: Path, *, dry_run: bool, skip: bool) -> int:
    if skip:
        print("    skipped (--skip-dedupe)")
        return 0
    dedupe_py = repo / "scripts" / "dedupe-livescenarios.py"
    spec = importlib.util.spec_from_file_location("dedupe_livescenarios", dedupe_py)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {dedupe_py}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.dedupe(root, dry_run=dry_run, quiet_banner=True)


def reconcile(
    root: Path,
    rclone_remote: str,
    *,
    dry_run: bool,
    skip_dedupe: bool,
) -> int:
    root = root.resolve()
    if not root.is_dir():
        print(f"Not a directory: {root}", file=sys.stderr)
        return 1

    repo = museum_root()
    print(f"Wrangler D1 target: {wrangler_target_label()}")
    print(f"Local folder: {root}")
    print(f"rclone remote: {rclone_remote}")
    if dry_run:
        print("Mode: DRY RUN")

    # --- 1/5 Load catalog ---
    stage(LABEL, 1, STAGES, "Load D1 catalog and tombstones (2 read-only queries)")
    catalog, tombstones = load_catalog(repo)
    local_keys = scan_local_keys(root)
    print(f"    catalog keys: {len(catalog)}")
    print(f"    tombstones:   {len(tombstones)}")
    print(f"    local files:  {len(local_keys)}")
    stage_done(LABEL, 1, STAGES)

    # --- 2/5 Tombstones ---
    stage(LABEL, 2, STAGES, "Remove local files for tombstoned keys (site deletes)")
    tomb_removed = apply_tombstones(root, tombstones, dry_run=dry_run)
    if tomb_removed == 0:
        print("    nothing to remove")
    stage_done(LABEL, 2, STAGES, f"removed {tomb_removed} local file(s)")
    if tomb_removed:
        local_keys = scan_local_keys(root)

    # --- 3/5 Download ---
    stage(LABEL, 3, STAGES, "Download catalog files missing on disk (targeted rclone copy)")
    want_local = catalog - tombstones
    to_download = sorted(want_local - local_keys)
    if to_download:
        print(f"    missing locally: {len(to_download)}")
        for key in to_download[:15]:
            print(f"      + {key}")
        if len(to_download) > 15:
            print(f"      ... and {len(to_download) - 15} more")
        rclone_copy_files(rclone_remote, root, to_download, dry_run=dry_run)
        local_keys = scan_local_keys(root)
        stage_done(LABEL, 3, STAGES, f"downloaded {len(to_download)} file(s)")
    else:
        print("    all catalog files already present locally")
        stage_done(LABEL, 3, STAGES, "nothing to download")

    extra_local = local_keys - want_local
    if extra_local:
        print(f"    note: {len(extra_local)} local-only file(s) will upload or be removed at sync")

    # --- 4/5 Dedupe ---
    stage(LABEL, 4, STAGES, "MD5 dedupe (one file per content; keep oldest copy)")
    dedupe_rc = run_dedupe(repo, root, dry_run=dry_run, skip=skip_dedupe)
    if dedupe_rc != 0:
        return dedupe_rc
    stage_done(LABEL, 4, STAGES)

    # --- 5/5 Sync ---
    stage(LABEL, 5, STAGES, "Push local folder to R2 (rclone sync; local is authoritative)")
    rclone_sync(root, rclone_remote, dry_run=dry_run)
    stage_done(LABEL, 5, STAGES, "R2 matches livescenarios folder")

    print()
    print(f"[{LABEL}] All {STAGES} stages complete.")
    return 0


def main() -> int:
    repo = museum_root()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=repo / "livescenarios",
        help="livescenarios folder",
    )
    parser.add_argument(
        "--rclone-remote",
        required=True,
        help='rclone remote path, e.g. "livescenarios:scenarios"',
    )
    parser.add_argument("--dry-run", action="store_true", help="Plan only; no deletes or rclone")
    parser.add_argument("--skip-dedupe", action="store_true", help="Skip MD5 dedupe step")
    args = parser.parse_args()
    return reconcile(
        args.root,
        args.rclone_remote,
        dry_run=args.dry_run,
        skip_dedupe=args.skip_dedupe,
    )


if __name__ == "__main__":
    raise SystemExit(main())
