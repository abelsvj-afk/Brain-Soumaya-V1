"""Diagnose the rim segment's dark diffuse on a COPY: UV coverage after
smart_project, diffuse bake without AO, AO bake raw. Original untouched."""
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
c = src.copy(); c.data = src.data.copy()
ext.collection.objects.link(c)
merged = merge_objects([c], "diag_seg", "station-rotating")
smart_uv(merged)
uvl = merged.data.uv_layers.active.data
area = 0.0
for poly in merged.data.polygons:
    pts = [uvl[i].uv for i in poly.loop_indices]
    for i in range(1, len(pts) - 1):
        area += abs((pts[i].x - pts[0].x) * (pts[i + 1].y - pts[0].y) -
                    (pts[i + 1].x - pts[0].x) * (pts[i].y - pts[0].y)) / 2
report(f"UV coverage (tri area sum): {area:.3f}")
mats = [s.material for s in merged.material_slots if s.material]
report(f"diag mats: {[m.name for m in mats]}")
diff = p2_lib._img("DIAG_diff", 512, 512, 'sRGB')
ao = p2_lib._img("DIAG_ao", 512, 512, 'Non-Color')
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.use_denoising = False
sc.render.bake.margin = 10
sc.render.bake.use_clear = True
bpy.ops.object.select_all(action='DESELECT')
merged.select_set(True)
bpy.context.view_layer.objects.active = merged
nodes = p2_lib._set_bake_target(mats, diff)
sc.cycles.samples = 1
sc.render.bake.use_pass_direct = False
sc.render.bake.use_pass_indirect = False
sc.render.bake.use_pass_color = True
bpy.ops.object.bake(type='DIFFUSE')
p2_lib._clear_bake_targets(nodes)
report("DIAG diffuse NO-AO @512: " + stats(diff))
nodes = p2_lib._set_bake_target(mats, ao)
sc.cycles.samples = 16
bpy.ops.object.bake(type='AO')
p2_lib._clear_bake_targets(nodes)
report("DIAG AO raw @512: " + stats(ao))
bpy.data.objects.remove(merged)
for im in (diff, ao):
    bpy.data.images.remove(im)
report("rimseg diag done")
