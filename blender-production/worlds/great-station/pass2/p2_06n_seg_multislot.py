"""Copy of the segment with the FIVE restored slots: bake diffuse only.
Isolates slot composition vs in-place/AO context."""
import bpy, sys, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
import numpy as np

def stats(img):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    rgb = px.reshape(-1, 4)[:, :3]
    covered = rgb[rgb.max(axis=1) > 0.01]
    return (f"mean_all={rgb.mean():.4f} mean_covered={covered.mean() if len(covered) else 0:.4f} "
            f"coverage={(len(covered) / len(rgb)) * 100:.1f}% max={rgb.max():.3f}")

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
src = bpy.data.objects["rim_segment_00"]
report(f"src slots now: {[s.material.name if s.material else None for s in src.material_slots]}")
report(f"src face material index histogram: " + str(__import__('collections').Counter(p.material_index for p in src.data.polygons)))
c = src.copy(); c.data = src.data.copy()
ext.collection.objects.link(c)
merged = merge_objects([c], "test_seg5", "station-rotating")
smart_uv(merged)
mats = [s.material for s in merged.material_slots if s.material]
diff = p2_lib._img("TEST5_diff", 256, 256, 'sRGB')
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.use_denoising = False
sc.render.bake.margin = 10
sc.render.bake.use_clear = True
sc.render.bake.use_pass_direct = False
sc.render.bake.use_pass_indirect = False
sc.render.bake.use_pass_color = True
bpy.ops.object.select_all(action='DESELECT')
merged.select_set(True)
bpy.context.view_layer.objects.active = merged
nodes = p2_lib._set_bake_target(mats, diff)
sc.cycles.samples = 1
bpy.ops.object.bake(type='DIFFUSE')
p2_lib._clear_bake_targets(nodes)
report("TEST5 five-slot diffuse @256: " + stats(diff))
bpy.data.objects.remove(merged)
bpy.data.images.remove(diff)
report("multislot test done")
