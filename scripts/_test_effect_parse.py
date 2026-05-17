#!/usr/bin/env python3
"""Synthetic DE effect parse tests (genie-scx layout)."""
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "sourcemodules" / "AoE2ScenarioParser"))
sys.path.insert(0, str(REPO / "sourcemodules"))

from AoE2ScenarioParser.helper.incremental_generator import IncrementalGenerator
from AoE2ScenarioParser.sections.aoe2_file_section import AoE2FileSection
from AoE2ScenarioParser.scenarios.aoe2_scenario import _get_structure
from AoE2ScenarioParser.sections.aoe2_struct_model import AoE2StructModel


def str32(s: str) -> bytes:
    raw = s.encode("utf-8") + b"\x00"
    return struct.pack("<i", len(raw)) + raw


def effect_send_chat(msg: str, sound: str = "", num_objects: int = -1) -> bytes:
    props = [-1] * 48
    props[4] = num_objects  # genie properties[4]
    props[7] = 1  # source_player
    out = struct.pack("<ii", 3, 48)
    out += struct.pack(f"<{len(props)}i", *props)
    out += str32(msg)
    out += str32(sound)
    if num_objects > 0:
        out += struct.pack(f"<{num_objects}i", *([100] * num_objects))
    return out


def effect_lock_gate(obj_id: int) -> bytes:
    props = [-1] * 48
    props[4] = 1
    props[5] = obj_id
    out = struct.pack("<ii", 7, 48)
    out += struct.pack(f"<{len(props)}i", *props)
    out += str32("")
    out += str32("")
    out += struct.pack("<i", obj_id)
    return out


def parse_effect_blob(blob: bytes) -> None:
    structure = _get_structure("DE", "1.43")
    cond_def = structure["Triggers"]["structs"]["TriggerStruct"]["structs"]["EffectStruct"]
    model = AoE2StructModel.from_structure("EffectStruct", cond_def)
    sec = AoE2FileSection.from_model(model, uuid=None)
    sec.set_data_from_generator(IncrementalGenerator("t", blob))
    n = sec.retriever_map["effect_properties"].data
    msg = sec.retriever_map["message"].data
    snd = sec.retriever_map["sound_name"].data
    oids = sec.retriever_map["selected_object_ids"].data
    print(f"  props len={len(n)} props[4]={n[4] if len(n) > 4 else '?'}")
    print(f"  message={msg!r} sound={snd!r} objects={oids}")


def main() -> int:
    print("send_chat long message:")
    parse_effect_blob(effect_send_chat("we come at a better time. Follow me.", "Play_72213"))
    print("lock_gate:")
    parse_effect_blob(effect_lock_gate(42))
    print("two effects chained:")
    parse_effect_blob(effect_lock_gate(1) + effect_send_chat("hello", "snd"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
