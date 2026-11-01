import bpy, sys, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
import numpy as np
objs = holder_meshes("drydock-witness")
report(f"witness meshes: {[(o.name, [s.material.name if s.material else None for s in o.material_slots]) for o in objs]}")
bake_l = []
for o in objs:
    mats = {s.material.name if s.material else '' for s in o.material_slots}
    if mats <= {'MAT_amber_emit', 'MAT_amber_emit_soft'}:
        continue
    if not o.data.materials or o.data.materials[0] is None or o.data.materials[0].name.startswith("BAKED_"):
        o.data.materials.clear()
        o.data.materials.append(bpy.data.materials["P2_basalt_plate"])
    bake_l.append(o)
info = bake_group(bake_l, "drydock_witness", "drydock-witness", res=512, use_ao=False)
report(f"witness bake: {info}")
img = bpy.data.images["TEX_drydock_witness_diff"]
wpx, hpx = img.size
px = np.empty(wpx * hpx * 4, dtype=np.float32)
img.pixels.foreach_get(px)
rgb = px.reshape(-1, 4)[:, :3]
covered = rgb[rgb.max(axis=1) > 0.01]
report(f"VERIFY witness diff: mean={rgb.mean():.4f} covered={covered.mean() if len(covered) else 0:.4f} cov%={(len(covered)/len(rgb))*100:.0f}")
assert covered.mean() > 0.05
save_master()
report("witness fixed + saved")
