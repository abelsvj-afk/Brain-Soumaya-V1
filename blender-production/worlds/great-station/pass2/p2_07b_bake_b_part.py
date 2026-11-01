"""Bake ONE script-B group (GROUP global set by wrapper), save immediately.
Groups: lunar colony stores model_lunar model_colony model_stores
        dressing_annex relic_mounts fallback worklights"""
import bpy, sys, json, os, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
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

SPECS = {
    "lunar": ("annex-lunar-annex", 1024), "colony": ("annex-colony-ring", 512),
    "stores": ("annex-station-stores", 512), "model_lunar": ("annex-model-lunar-annex", 512),
    "model_colony": ("annex-model-colony-ring", 512), "model_stores": ("annex-model-station-stores", 512),
    "dressing_annex": ("dressing-annex", 512), "relic_mounts": ("relic-mounts", 512),
}
if GROUP == "fallback":
    bake_l, emis_l = part("station-traffic-fallback")
    for o in bake_l:
        o.data.materials.clear()
        o.data.materials.append(bpy.data.materials["P2_hull_pale"])
    if bake_l:
        mark("fallback", bake_group(bake_l, "fallback", "station-traffic-fallback", res=256, use_ao=False))
elif GROUP == "worklights":
    bake_l, emis_l = part("station-work-lights")
    if bake_l:
        mark("worklight_poles", bake_group(bake_l, "worklight_poles", "station-work-lights", res=512, use_ao=False))
    if emis_l:
        emis_merge(emis_l, "worklight_heads_amber", "station-work-lights")
else:
    holder, res = SPECS[GROUP]
    bake_l, emis_l = part(holder)
    report(f"{GROUP}: bake={[o.name for o in bake_l]} emis={len(emis_l)}")
    if bake_l:
        mark(GROUP, bake_group(bake_l, GROUP, holder, res=res, use_ao=False))
    if emis_l:
        emis_merge(emis_l, GROUP + "_amber_emit", holder)
save_master()
report(f"B-part {GROUP} done + saved")
