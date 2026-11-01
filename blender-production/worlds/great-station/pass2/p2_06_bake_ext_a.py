"""Pass 2 bake A (exterior): rim segment, wheel rest, gantry, drydocks, dressing.
Saves the pre-bake master copy first. Progress -> bake_status.json."""
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

def part(holder, exclude_prefixes=()):
    bake, emis, cyan = [], [], []
    for o in holder_meshes(holder):
        if any(o.name.startswith(p) for p in exclude_prefixes):
            continue
        mats = {s.material.name if s.material else '' for s in o.material_slots}
        if mats and mats <= {'MAT_amber_emit', 'MAT_amber_emit_soft'}:
            emis.append(o)
        elif mats and mats <= {'MAT_cyan_emit'}:
            cyan.append(o)
        elif mats & {'MAT_glass', 'MAT_planet_lava', 'MAT_planet_q1', 'MAT_stardome'}:
            continue
        else:
            bake.append(o)
    return bake, emis, cyan

def emis_merge(objs, name, holder):
    if len(objs) > 1:
        return merge_objects(objs, name, holder)
    return objs[0] if objs else None

# pre-bake safety copy (once)
if not os.path.exists("/home/hatch/workspace/Soumaya-Environment-Production/source/pass2-backups/soumaya_worlds_master_pass2_prebake.blend"):
    bpy.ops.wm.save_as_mainfile(
        filepath="/home/hatch/workspace/Soumaya-Environment-Production/source/pass2-backups/soumaya_worlds_master_pass2_prebake.blend",
        copy=True)
    report("pre-bake copy saved")

# ---- rim segment (shared datablock: baking instance 00 updates all 48) ----
seg = bpy.data.objects["rim_segment_00"]
info = bake_group([seg], "rimseg", "station-rotating", res=1024, emissive_map=True, use_ao=False)
seg.name = "rim_segment_00"
mark("rimseg", info)

# ---- wheel rest ----
bake_l, emis_l, cyan_l = part("station-rotating", exclude_prefixes=("rim_segment_",))
info = bake_group(bake_l, "wheel_rest", "station-rotating", res=1024, use_ao=False)
mark("wheel_rest", info)
if emis_l:
    emis_merge(emis_l, "wheel_amber_emit", "station-rotating")
if cyan_l:
    emis_merge(cyan_l, "wheel_cyan_emit", "station-rotating")
mark("wheel_emissives", {"amber_merged": len(emis_l), "cyan_merged": len(cyan_l)})

# ---- gantry (incl. berth board) ----
bake_l, emis_l, _ = part("witness-drydock-gantry")
info = bake_group(bake_l, "gantry", "witness-drydock-gantry", res=1024, use_ao=False)
mark("gantry", info)
if emis_l:
    emis_merge(emis_l, "gantry_amber_emit", "witness-drydock-gantry")

# ---- drydocks + dressing ----
bake_l, emis_l, _ = part("drydock-main")
mark("drydock_main", bake_group(bake_l, "drydock_main", "drydock-main", res=512, use_ao=False))
if emis_l:
    emis_merge(emis_l, "drydock_main_amber", "drydock-main")
# drydock-witness: merged mesh still wears its hollow-group smoke bake in the
# reset base -> normalise to uniform basalt, then bake fresh (no AO).
bake_l, emis_l, _ = part("drydock-witness")
for o in bake_l:
    if (not o.data.materials or o.data.materials[0] is None
            or o.data.materials[0].name.startswith("BAKED_")):
        o.data.materials.clear()
        o.data.materials.append(bpy.data.materials["P2_basalt_plate"])
mark("drydock_witness", bake_group(bake_l, "drydock_witness", "drydock-witness", res=512, use_ao=False))
bake_l, emis_l, _ = part("dressing-drydock")
mark("dressing_drydock", bake_group(bake_l, "dressing_drydock", "dressing-drydock", res=512, use_ao=False))

save_master()
raw, est = draw_estimate(ext)
mark("exterior_draw_after_A", {"raw": raw, "sets": est})
report("bake A done")
