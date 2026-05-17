#!/usr/bin/env python3
"""Apply variable trigger property-count fixes to DE structure.json (v1.40+)."""
from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VERSIONS_ROOT = REPO / "sourcemodules" / "AoE2ScenarioParser" / "versions" / "DE"

SKIP_EFFECTS_DYNAMIC = {"effect_properties"}  # v1.43+ dynamic effect blob
SKIP_FIELDS = {"_extra_effect_properties", "_extra_condition_properties"}


def version_key(name: str) -> float:
    return float(name[1:])


def property_keys(retrievers: dict, static_key: str, stop_key: str) -> list[str]:
    keys = list(retrievers.keys())
    start = keys.index(static_key) + 1
    end = keys.index(stop_key)
    return [k for k in keys[start:end] if k not in SKIP_FIELDS and k not in SKIP_EFFECTS_DYNAMIC]


def set_positional_conditional(field: dict, static_key: str, pos_1based: int) -> None:
    field.setdefault("dependencies", {})
    field["dependencies"]["on_construct"] = {
        "action": "SET_REPEAT",
        "target": f"self:{static_key}",
        "eval": f"1 if {static_key} >= {pos_1based} else 0",
    }


def ensure_extra(
    retrievers: dict,
    static_key: str,
    full_count: int,
    extra_name: str,
    before_key: str,
) -> None:
    extra = {
        "type": "s32",
        "default": -1,
        "dependencies": {
            "on_construct": {
                "action": "SET_REPEAT",
                "target": f"self:{static_key}",
                "eval": f"{static_key} - {full_count} if {static_key} > {full_count} else 0",
            }
        },
    }
    if extra_name in retrievers:
        retrievers[extra_name] = extra
        return
    ordered = list(retrievers.keys())
    insert_at = ordered.index(before_key)
    new_retrievers: dict = {}
    for key in ordered[:insert_at]:
        new_retrievers[key] = retrievers[key]
    new_retrievers[extra_name] = extra
    for key in ordered[insert_at:]:
        new_retrievers[key] = retrievers[key]
    retrievers.clear()
    retrievers.update(new_retrievers)


def patch_struct(retrievers: dict, static_key: str, stop_key: str, extra_name: str) -> bool:
    if static_key not in retrievers:
        return False
    props = property_keys(retrievers, static_key, stop_key)
    if not props:
        return False
    # Skip if spill array already present (manual or prior patch).
    if extra_name in retrievers:
        return False
    for idx, key in enumerate(props, start=1):
        field = retrievers[key]
        dep = (field.get("dependencies") or {}).get("on_construct") or {}
        existing = dep.get("eval", "")
        expected = f"1 if {static_key} >= {idx} else 0"
        if existing != expected:
            set_positional_conditional(field, static_key, idx)
    ensure_extra(retrievers, static_key, len(props), extra_name, stop_key)
    return True


def patch_version(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    structs = data["Triggers"]["structs"]["TriggerStruct"]["structs"]
    eff = structs["EffectStruct"]["retrievers"]
    cond = structs["ConditionStruct"]["retrievers"]

    eff_static = next((k for k in eff if re.fullmatch(r"static_value_\d+", k)), None)
    cond_static = next((k for k in cond if re.fullmatch(r"static_value_\d+", k)), None)
    if not eff_static or not cond_static:
        return {"version": path.parent.name, "skipped": "missing static_value"}

    eff_changed = False
    cond_changed = False

    if "effect_properties" not in eff:
        eff_changed = patch_struct(eff, eff_static, "message", "_extra_effect_properties")
    cond_changed = patch_struct(cond, cond_static, "xs_function", "_extra_condition_properties")

    if eff_changed or cond_changed:
        path.write_text(json.dumps(data, indent=4) + "\n", encoding="utf-8")

    return {
        "version": path.parent.name,
        "effect_props": len(property_keys(eff, eff_static, "message")) if "effect_properties" not in eff else "dynamic",
        "cond_props": len(property_keys(cond, cond_static, "xs_function")),
        "eff_static": eff_static,
        "cond_static": cond_static,
        "eff_def": eff[eff_static].get("default"),
        "cond_def": cond[cond_static].get("default"),
        "patched_eff": eff_changed,
        "patched_cond": cond_changed,
    }


def main() -> int:
    rows = []
    for path in sorted(VERSIONS_ROOT.glob("v*/structure.json"), key=lambda p: version_key(p.parent.name)):
        if version_key(path.parent.name) < 1.40:
            continue
        rows.append(patch_version(path))
    print(json.dumps(rows, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
