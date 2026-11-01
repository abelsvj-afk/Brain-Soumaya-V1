"""Fix the .001-group disease and re-bake the rim segment:
1) scan every mesh slot for P2 materials whose GRP points at the wrong group;
2) re-point all .001 materials at GS_SURFACE;
3) restore the segment's original slots (base material names);
4) re-bake it with siblings temporarily swapped to a dummy mesh (single-user
   bake), restore siblings, verify diffuse stats, save."""
import bpy, sys, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
import numpy as np

G = bpy.data.node_groups["GS_SURFACE"]
bad = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for s in o.material_slots:
        m = s.material
        if m and m.use_nodes:
            grp = m.node_tree.nodes.get("GRP")
            if grp and grp.node_tree != G:
                bad.append((o.name, m.name, grp.node_tree.name if grp.node_tree else None))
report(f"SCAN wrong-group slots: {bad}")

fixed = 0
for m in bpy.data.materials:
    if m.use_nodes:
        grp = m.node_tree.nodes.get("GRP")
        if grp and grp.node_tree != G and grp.node_tree is not None:
            grp.node_tree = G
            fixed += 1
report(f"re-pointed {fixed} materials to GS_SURFACE")

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
seg = bpy.data.objects["rim_segment_00"]
slots = ["P2_basalt_plate", "P2_gunmetal", "P2_gunmetal_dark", "MAT_amber_emit_soft", "MAT_dark_unlit"]
seg.data.materials.clear()
for nm in slots:
    seg.data.materials.append(bpy.data.materials[nm])
report(f"segment slots restored: {[s.material.name for s in seg.material_slots]}")

siblings = [o for o in bpy.data.objects if o.type == 'MESH' and o.data == seg.data and o != seg]
dummy = bpy.data.meshes.new("dummy_swap")
for o in siblings:
    o.data = dummy
report(f"swapped {len(siblings)} siblings to dummy")
try:
    info = bake_group([seg], "rimseg", "station-rotating", res=1024, emissive_map=True, use_ao=True)
finally:
    real = bpy.data.objects["rimseg"].data if bpy.data.objects.get("rimseg") else seg.data
    for o in siblings:
        o.data = real
    if dummy.users == 0:
        bpy.data.meshes.remove(dummy)
report(f"segment re-bake: {info}")
seg2 = bpy.data.objects.get("rimseg")
if seg2 and seg2.name != "rim_segment_00":
    seg2.name = "rim_segment_00"
img = bpy.data.images["TEX_rimseg_diff"]
wpx, hpx = img.size
px = np.empty(wpx * hpx * 4, dtype=np.float32)
img.pixels.foreach_get(px)
rgb = px.reshape(-1, 4)[:, :3]
covered = rgb[rgb.max(axis=1) > 0.01]
report(f"VERIFY rimseg diff (linear): mean_all={rgb.mean():.4f} covered={covered.mean() if len(covered) else 0:.4f} "
       f"coverage={(len(covered) / len(rgb)) * 100:.1f}%")
assert len(covered) / len(rgb) > 0.3 and covered.mean() > 0.05, "rimseg diffuse STILL bad"
save_master()
report("segment re-bake saved")
