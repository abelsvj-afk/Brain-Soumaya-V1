"""Pass 2 bake D (interior): all four rooms, floors, ceilings, lintels,
rim arc, bay/user ships, fleet models; emissive merges per holder;
nav markers merged (cyan, navigation truth only)."""
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

# rooms
for holder, tag, res, ao in (
        ("hangar-bay", "hangar", 1024, False),
        ("commission-board", "commission", 1024, False),
        ("fleet-deck", "fleet", 512, False),
        ("observation-deck", "observation", 1024, False)):
    bake_l, emis_l = part(holder)
    if bake_l:
        mark(tag, bake_group(bake_l, tag, holder, res=res, use_ao=ao))
    if emis_l:
        emis_merge(emis_l, tag + "_amber_emit", holder)

# floors + ceilings
for holder, tag in (
        ("interior-floor-hangar-bay", "floor_hangar"),
        ("interior-floor-commission-board", "floor_commission"),
        ("interior-floor-fleet-deck", "floor_fleet"),
        ("interior-floor-observation-deck", "floor_observation"),
        ("interior-ceiling-hangar-bay", "ceiling_hangar"),
        ("interior-ceiling-commission-board", "ceiling_commission"),
        ("interior-ceiling-fleet-deck", "ceiling_fleet"),
        ("interior-ceiling-observation-deck", "ceiling_observation")):
    bake_l, emis_l = part(holder)
    if emis_l:
        emis_merge(emis_l, tag + "_amber_emit", holder)
    if bake_l:
        res = 1024 if tag == "floor_hangar" else 512
        mark(tag, bake_group(bake_l, tag, holder, res=res, use_ao=False))

# lintels + rim arc
for holder, tag in (
        ("interior-deck-viewport-lintel", "viewport_lintel"),
        ("interior-gate-lintel", "gate_lintel"),
        ("interior-bay-door-lintel", "baydoor_lintel"),
        ("interior-rim-arc", "rim_arc")):
    bake_l, _ = part(holder)
    if bake_l:
        mark(tag, bake_group(bake_l, tag, holder, res=512, use_ao=False))

# ships + fleet models
for holder, tag, ao in (
        ("interior-bay-ship", "bay_ship", False),
        ("interior-user-ship", "user_ship", False),
        ("interior-model-fleet-1", "fleet_model_1", False),
        ("interior-model-fleet-2", "fleet_model_2", False)):
    bake_l, _ = part(holder)
    if bake_l:
        mark(tag, bake_group(bake_l, tag, holder, res=512, use_ao=ao))

# shared emissive/cyan holders: merge to one mesh each (flat literal materials)
for holder, name in (
        ("interior-gate-lights", "gate_lights_amber"),
        ("interior-light-strips", "light_strips_amber"),
        ("interior-work-lights", "work_lights_amber"),
        ("interior-nav-markers", "nav_markers_cyan")):
    ms = holder_meshes(holder)
    if len(ms) > 1:
        merge_objects(ms, name, holder)
        mark(name, {"merged": len(ms)})

save_master()
raw, est = draw_estimate(intr)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in intr.objects if o.type == 'MESH')
mark("interior_draw_after_D", {"raw": raw, "sets": est, "tris_scene_objects": tris})
report("bake D (interior) done")
