"""Minimal wrangler D1 helpers for local batch scripts (reconcile, backfill)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

D1_DATABASE = "scenarios"


def museum_root() -> Path:
    env = os.environ.get("MUSEUM_ROOT")
    if env:
        return Path(env).resolve()
    return Path(__file__).resolve().parents[1]


def wrangler_flag(root: Path) -> list[str]:
    return ["--local"] if os.environ.get("WRANGLER_D1_LOCAL") == "1" else ["--remote"]


def _wrangler_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PYTHONUTF8", "1")
    return env


def _wrangler_argv(root: Path, *args: str) -> list[str]:
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


def wrangler_target_label() -> str:
    return "local" if os.environ.get("WRANGLER_D1_LOCAL") == "1" else "remote"
