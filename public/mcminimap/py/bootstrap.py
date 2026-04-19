"""Bootstrap for the client-side McMinimap renderer.

Invoked once after the vendored AOE2-McMinimap tree has been unpacked into
``/home/pyodide/aoe2mcminimap``. Exposes ``render(file_bytes, ext, settings)``
which the JS worker calls per-render.
"""

from __future__ import annotations

import os
import sys
import tempfile

_VENDOR_DIR = "/home/pyodide/aoe2mcminimap"
# `pylibs/` holds pure-Python packages that micropip cannot install as wheels
# (notably `construct==2.8.16`, which the vendored happyleaves mgz tree pins).
# Placed before site-packages so our pinned version wins any version race.
_PYLIBS_DIR = _VENDOR_DIR + "/pylibs"
for _p in (_PYLIBS_DIR, _VENDOR_DIR):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from McMinimap import MinimapSettings, to_png_bytes  # noqa: E402


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
