"""Bake the fallback hull properly (repair skipped it: the merged mesh is
named 'fallback', not 'traffic_fallback_hull')."""
import bpy, sys, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
import numpy as np

meshes = holder_meshes("station-traffic-fallback")
report(f"fallback holder meshes: {[(o.name, [s.material.name if s.material else None for s in o.material_slots]) for o in meshes]}")
assert len(meshes) == 1
fb = meshes[0]
fb.data.materials.clear()
fb.data.materials.append(bpy.data.materials["P2_hull_pale"])
info = bake_group([fb], "fallback", "station-traffic-fallback", res=256, use_ao=False)
report(f"fallback bake: {info}")
img = bpy.data.images["TEX_fallback_diff"]
wpx, hpx = img.size
px = np.empty(wpx * hpx * 4, dtype=np.float32)
img.pixels.foreach_get(px)
report(f"VERIFY TEX_fallback_diff mean={px.mean():.4f} max={px.max():.3f}")
assert px.mean() > 0.02, "fallback diffuse still black"
save_master()
report("fallback fixed + saved")
