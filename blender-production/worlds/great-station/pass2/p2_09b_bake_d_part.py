"""Bake ONE script-D interior group (GROUP global), save immediately.
Groups: hangar commission fleet observation | floor_* ceiling_* |
viewport_lintel gate_lintel baydoor_lintel rim_arc |
bay_ship user_ship fleet_model_1 fleet_model_2 | emissive_merges"""
import bpy, sys, json, os, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *

intr = bpy.data.scenes["STATION_INTERIOR"]
set_scene(intr)
STATUS = P2_DIR + "/bake_status.json"

def mark(key, val):
    st = json.load(open(STATUS)) if os.path.exists(STATUS) else {}
    st[key] = val
    json.dump(st, open(STATUS, "w"), indent=1)
    report(f"BAKE-STATUS {key}: {val}")

def part(holder):
    bake, emis = [], []
    for o in holder_meshes(holder):
        mats = {s.material.name if s.material else '' for s in o.material_slots}
        if mats and mats <= {'MAT_amber_emit', 'MAT_amber_emit_soft'}:
            emis.append(o)
        elif mats & {'MAT_glass', 'MAT_planet_lava', 'MAT_planet_q1', 'MAT_stardome', 'MAT_cyan_emit'}:
            continue
        else:
            bake.append(o)
    return bake, emis

def emis_merge(objs, name, holder):
    if len(objs) > 1:
        return merge_objects(objs, name, holder)
    return objs[0] if objs else None

ROOMS = {"hangar": ("hangar-bay", 1024), "commission": ("commission-board", 1024),
         "fleet": ("fleet-deck", 512), "observation": ("observation-deck", 1024)}
FLAT = {"floor_hangar": ("interior-floor-hangar-bay", 1024),
        "floor_commission": ("interior-floor-commission-board", 512),
        "floor_fleet": ("interior-floor-fleet-deck", 512),
        "floor_observation": ("interior-floor-observation-deck", 512),
        "ceiling_hangar": ("interior-ceiling-hangar-bay", 512),
        "ceiling_commission": ("interior-ceiling-commission-board", 512),
        "ceiling_fleet": ("interior-ceiling-fleet-deck", 512),
        "ceiling_observation": ("interior-ceiling-observation-deck", 512),
        "viewport_lintel": ("interior-deck-viewport-lintel", 512),
        "gate_lintel": ("interior-gate-lintel", 512),
        "baydoor_lintel": ("interior-bay-door-lintel", 512),
        "rim_arc": ("interior-rim-arc", 512)}
SHIPS = {"bay_ship": "interior-bay-ship", "user_ship": "interior-user-ship",
         "fleet_model_1": "interior-model-fleet-1", "fleet_model_2": "interior-model-fleet-2"}

if GROUP == "emissive_merges":
    for holder, name in (
            ("interior-gate-lights", "gate_lights_amber"),
            ("interior-light-strips", "light_strips_amber"),
            ("interior-work-lights", "work_lights_amber"),
            ("interior-nav-markers", "nav_markers_cyan")):
        ms = holder_meshes(holder)
        if len(ms) > 1:
            merge_objects(ms, name, holder)
            mark(name, {"merged": len(ms)})
elif GROUP in ROOMS:
    holder, res = ROOMS[GROUP]
    bake_l, emis_l = part(holder)
    if bake_l:
        mark(GROUP, bake_group(bake_l, GROUP, holder, res=res, use_ao=False))
    if emis_l:
        emis_merge(emis_l, GROUP + "_amber_emit", holder)
elif GROUP in FLAT:
    holder, res = FLAT[GROUP]
    bake_l, emis_l = part(holder)
    if emis_l:
        emis_merge(emis_l, GROUP + "_amber_emit", holder)
    if bake_l:
        mark(GROUP, bake_group(bake_l, GROUP, holder, res=res, use_ao=False))
elif GROUP in SHIPS:
    holder = SHIPS[GROUP]
    bake_l, _ = part(holder)
    if bake_l:
        mark(GROUP, bake_group(bake_l, GROUP, holder, res=512, use_ao=False))
save_master()
report(f"D-part {GROUP} done + saved")
