"""Segment bake test on a single-user copy with uniform P2_basalt_plate,
plus: read the segment's ORIGINAL material slots from the p2-05 backup."""
import bpy, sys, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
import numpy as np

# original slots from the pre-bake backup
with bpy.data.libraries.load("/home/hatch/workspace/Soumaya-Environment-Production/source/pass2-backups/soumaya_worlds_master_p2-05-interior.blend", link=False) as (src, dst):
    dst.meshes = [n for n in src.meshes if n == "rim_segment_mesh_v2"]
bm = dst.meshes[0]
report(f"backup segment slots: {[s.name if s else None for s in bm.materials]}")
bpy.data.meshes.remove(bm)

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
c.data.materials.clear()
c.data.materials.append(bpy.data.materials["P2_basalt_plate"])
merged = merge_objects([c], "test_seg", "station-rotating")
smart_uv(merged)
diff = p2_lib._img("TEST_diff", 256, 256, 'sRGB')
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
nodes = p2_lib._set_bake_target([bpy.data.materials["P2_basalt_plate"]], diff)
sc.cycles.samples = 1
bpy.ops.object.bake(type='DIFFUSE')
p2_lib._clear_bake_targets(nodes)
report("TEST uniform P2_basalt diffuse @256: " + stats(diff))
bpy.data.objects.remove(merged)
bpy.data.images.remove(diff)
report("seg test done")
