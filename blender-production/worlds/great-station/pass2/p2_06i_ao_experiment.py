"""Isolate the dark diffuse: on the gantry holder (small), bake
(1) diffuse WITHOUT AO, (2) an AO-only pass dumped raw.
Restores the gantry meshes afterwards from the pre-bake state is NOT possible
post-merge, so this runs on a COPY: it duplicates the holder's current mesh,
bakes the copy aside, reports, deletes the copy. The real gantry bake in
script A uses the original objects."""
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
            f"coverage={(len(covered) / len(rgb)) * 100:.0f}% max={rgb.max():.3f}")

# use the DRYDOCK-MAIN holder (not yet baked when this runs after A? it IS baked
# by A) -> instead use relic-mounts (small, unbaked until script B)
objs = holder_meshes("relic-mounts")
report(f"experiment objects: {[o.name for o in objs]}")
copies = []
ext = bpy.data.scenes["STATION_EXTERIOR"]
for o in objs:
    c = o.copy(); c.data = o.data.copy()
    ext.collection.objects.link(c)
    copies.append(c)
merged = merge_objects(copies, "exp_noao", "relic-mounts")
smart_uv(merged)
mats = [s.material for s in merged.material_slots if s.material]
diff = _img("EXP_diff", 512, 512, 'sRGB')
ao = _img("EXP_ao", 512, 512, 'Non-Color')
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.use_denoising = False
sc.render.bake.margin = 10
sc.render.bake.use_clear = True
bpy.ops.object.select_all(action='DESELECT')
merged.select_set(True)
bpy.context.view_layer.objects.active = merged
nodes = _set_bake_target(mats, diff)
sc.cycles.samples = 1
bpy.ops.object.bake(type='DIFFUSE', use_pass_direct=False, use_pass_indirect=False, use_pass_color=True)
_clear_bake_targets(nodes)
report("EXP diffuse NO-AO: " + stats(diff))
nodes = _set_bake_target(mats, ao)
sc.cycles.samples = 16
bpy.ops.object.bake(type='AO')
_clear_bake_targets(nodes)
report("EXP AO raw: " + stats(ao))
bpy.data.objects.remove(merged)
for im in (diff, ao):
    bpy.data.images.remove(im)
report("experiment done (originals untouched)")
