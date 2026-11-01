"""Bake ONE script-C ship group (GROUP global), save immediately."""
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

SPECS = {
    "hero_ship": "hero-ship", "traffic_01": "traffic-01", "traffic_02": "traffic-02",
    "traffic_03": "traffic-03", "traffic_04": "traffic-04", "traffic_05": "traffic-05",
    "traffic_06": "traffic-06", "docked_01": "docked-01", "docked_02": "docked-02",
    "docked_03": "docked-03", "hauler": "witness-hauler",
    "controller": "harbor-controller-ship", "shuttle": "docking-shuttle",
}
holder = SPECS[GROUP]
bake_l = part(holder)
report(f"{GROUP}: bake={[o.name for o in bake_l]}")
if bake_l:
    mark(GROUP, bake_group(bake_l, GROUP, holder, res=512, use_ao=False))
save_master()
report(f"C-part {GROUP} done + saved")
