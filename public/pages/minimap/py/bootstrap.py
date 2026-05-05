"""Bootstrap for the client-side McMinimap renderer.

Invoked once after the vendored AOE2-McMinimap tree has been unpacked into
``/home/pyodide/aoe2mcminimap``. Exposes ``render(file_bytes, ext, settings)``
which the JS worker calls per-render, and ``parse_campaign_index_json`` for
campaign index parsing.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile

_VENDOR_DIR = "/home/pyodide/aoe2mcminimap"
# `pylibs/` holds pure-Python packages that micropip cannot install as wheels
# (``construct==2.8.16`` and ``aocref``, both sdist-only on PyPI). Placed
# before site-packages so our pinned versions win any version race.
_PYLIBS_DIR = _VENDOR_DIR + "/pylibs"
for _p in (_PYLIBS_DIR, _VENDOR_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Fail loudly at boot if a vendored package is missing, so the worker
# surfaces "aocref missing" instead of the unhelpful
# "json object must be str, bytes or bytearray, not NoneType" that
# ``json.loads(pkgutil.get_data(...))`` would raise mid-render.
import importlib.util  # noqa: E402

for _pkg in ("construct", "aocref"):
    if importlib.util.find_spec(_pkg) is None:
        raise ImportError(
            f"vendored package {_pkg!r} not found on sys.path; "
            "check that fetch-pylibs output (sourcemodules/construct, sourcemodules/aocref) "
            "was bundled into aoe2mcminimap.tar (scripts/build-mcminimap-bundle.mjs)."
        )

from types import SimpleNamespace  # noqa: E402

from McMinimap import MinimapSettings, to_png_bytes, to_png_bytes_from_match  # noqa: E402


def _coerce_settings(raw):
    """Accept a dict (possibly a JsProxy.to_py'd dict) and build MinimapSettings.

    ``final_size`` arrives as a 2-element list from JS; convert to a tuple.
    Unknown keys are dropped so the UI and renderer can drift independently
    without crashing.
    """
    if hasattr(raw, "to_py"):
        raw = raw.to_py()
    data = dict(raw or {})

    final_size = data.get("final_size")
    if final_size is not None:
        data["final_size"] = tuple(int(x) for x in final_size)

    allowed = set(MinimapSettings.__dataclass_fields__.keys())
    clean = {k: v for k, v in data.items() if k in allowed and v is not None}
    return MinimapSettings(**clean)


def render(file_bytes, ext, settings):
    """Render the uploaded replay/scenario to PNG bytes.

    ``file_bytes`` is a ``Uint8Array`` (JsProxy); bounce it through
    ``bytes(...)`` to materialise a Python bytes object we can write to disk.
    """
    if hasattr(file_bytes, "to_py"):
        data = bytes(file_bytes.to_py())
    else:
        data = bytes(file_bytes)

    suffix = ext if ext and ext.startswith(".") else "." + (ext or "bin")
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        tmp.write(data)
        tmp.flush()
        tmp.close()
        cfg = _coerce_settings(settings)
        return to_png_bytes(tmp.name, settings=cfg)
    finally:
        try:
            os.remove(tmp.name)
        except OSError:
            pass


def _ns(obj):
    """Recursively convert dict/list structures into SimpleNamespace trees.

    McMinimap's in-memory render path expects attribute access (match.map.tiles[*].position.x, etc).
    """
    if hasattr(obj, "to_py"):
        obj = obj.to_py()
    if isinstance(obj, dict):
        return SimpleNamespace(**{k: _ns(v) for k, v in obj.items()})
    if isinstance(obj, (list, tuple)):
        return [_ns(v) for v in obj]
    return obj


def render_match(match_obj, settings):
    """Render from an in-memory `match` object (no temp file, no extension routing)."""
    cfg = _coerce_settings(settings)
    match_ns = _ns(match_obj)
    return to_png_bytes_from_match(match_ns, settings=cfg)


def parse_campaign_index_json(file_bytes):
    """Return JSON describing campaign scenarios for the worker (success or error).

    ``file_bytes`` is a ``Uint8Array`` (JsProxy) from Pyodide.
    """
    try:
        if hasattr(file_bytes, "to_py"):
            data = bytes(file_bytes.to_py())
        else:
            data = bytes(file_bytes)
        from legacy.aoe2campaignparser import parse_campaign_index  # noqa: PLC0415

        campaign_name, scenarios = parse_campaign_index(data)
        return json.dumps(
            {
                "ok": True,
                "campaignName": campaign_name,
                "scenarios": scenarios,
            }
        )
    except Exception as e:  # noqa: BLE001 — surface any parse failure to the UI
        return json.dumps({"ok": False, "error": str(e)})
