"""Consistent stage banners for livescenarios pipeline scripts (ASCII only)."""

from __future__ import annotations

import sys

_WIDTH = 70


def stage(label: str, current: int, total: int, title: str) -> None:
    """Print a visible stage header before work begins."""
    bar = "=" * _WIDTH
    print(file=sys.stdout, flush=True)
    print(bar, file=sys.stdout, flush=True)
    print(f"  [{label} {current}/{total}] {title}", file=sys.stdout, flush=True)
    print(bar, file=sys.stdout, flush=True)
    print(file=sys.stdout, flush=True)


def stage_done(label: str, current: int, total: int, summary: str = "") -> None:
    """Print a one-line completion marker after a stage."""
    msg = f"  [{label} {current}/{total}] DONE"
    if summary:
        msg = f"{msg} - {summary}"
    print(msg, file=sys.stdout, flush=True)
    print(file=sys.stdout, flush=True)
