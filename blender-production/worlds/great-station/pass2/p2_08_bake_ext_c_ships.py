"""Pass 2 bake C (exterior ships): hero, traffic x6, docked x3, hauler,
controller, shuttle. Engine glows (flat amber) and the controller's cyan nav
marker stay unmerged/unbaked — literal-input materials, export-lossless."""
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
    bake = []
    for o in holder_meshes(holder):
        mats = {s.material.name if s.material else '' for s in o.material_slots}
        if mats & {'MAT_amber_emit', 'MAT_amber_emit_soft', 'MAT_cyan_emit', 'MAT_glass'}:
            continue
        bake.append(o)
    return bake

for holder, tag, ao in (
        ("hero-ship", "hero_ship", False),
        ("traffic-01", "traffic_01", False), ("traffic-02", "traffic_02", False),
        ("traffic-03", "traffic_03", False), ("traffic-04", "traffic_04", False),
        ("traffic-05", "traffic_05", False), ("traffic-06", "traffic_06", False),
        ("docked-01", "docked_01", False), ("docked-02", "docked_02", False),
        ("docked-03", "docked_03", False),
        ("witness-hauler", "hauler", False),
        ("harbor-controller-ship", "controller", False),
        ("docking-shuttle", "shuttle", False)):
    bake_l = part(holder)
    if bake_l:
        mark(tag, bake_group(bake_l, tag, holder, res=512, use_ao=ao))

save_master()
raw, est = draw_estimate(ext)
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in ext.objects if o.type == 'MESH')
mark("exterior_draw_after_C", {"raw": raw, "sets": est, "tris_scene_objects": tris})
report("bake C done")
