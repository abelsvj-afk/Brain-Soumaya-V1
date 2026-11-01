"""Pass 2 bake B (exterior): annexes, annex models, dressing-annex,
work-lights, relic mounts, traffic fallback."""
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

for holder, tag, res, ao in (
        ("annex-lunar-annex", "lunar", 1024, False),
        ("annex-colony-ring", "colony", 512, False),
        ("annex-station-stores", "stores", 512, False),
        ("annex-model-lunar-annex", "model_lunar", 512, False),
        ("annex-model-colony-ring", "model_colony", 512, False),
        ("annex-model-station-stores", "model_stores", 512, False),
        ("dressing-annex", "dressing_annex", 512, False),
        ("relic-mounts", "relic_mounts", 512, False)):
    bake_l, emis_l = part(holder)
    bake_l, emis_l = part(holder)
    if bake_l:
        mark(tag, bake_group(bake_l, tag, holder, res=res, use_ao=ao))
    if emis_l:
        emis_merge(emis_l, tag + "_amber_emit", holder)

# traffic fallback: wears its hollow-group smoke bake in the reset base ->
# normalise to P2_hull_pale, bake fresh (no AO).
bake_l, emis_l = part("station-traffic-fallback")
for o in bake_l:
    o.data.materials.clear()
    o.data.materials.append(bpy.data.materials["P2_hull_pale"])
if bake_l:
    mark("fallback", bake_group(bake_l, "fallback", "station-traffic-fallback", res=256, use_ao=False))

bake_l, emis_l = part("station-work-lights")
if bake_l:
    mark("worklight_poles", bake_group(bake_l, "worklight_poles", "station-work-lights", res=512, use_ao=False))
if emis_l:
    emis_merge(emis_l, "worklight_heads_amber", "station-work-lights")

save_master()
raw, est = draw_estimate(ext)
mark("exterior_draw_after_B", {"raw": raw, "sets": est})
report("bake B done")
