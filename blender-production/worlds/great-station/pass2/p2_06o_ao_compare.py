"""Compare raw AO bakes: segment copy (slots restored) vs gantry copy.
Also segment diffuse with and without the AO multiply."""
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
            f"coverage={(len(covered) / len(rgb)) * 100:.1f}%")

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.use_denoising = False
sc.render.bake.margin = 10
sc.render.bake.use_clear = True

def bake_pair(objs, restore_slots, tag):
    copies = []
    for o in objs:
        c = o.copy(); c.data = o.data.copy()
        ext.collection.objects.link(c)
        copies.append(c)
    merged = merge_objects(copies, tag, copies[0].parent.name if copies[0].parent else "station-world")
    if restore_slots:
        merged.data.materials.clear()
        for nm in restore_slots:
            merged.data.materials.append(bpy.data.materials[nm])
    smart_uv(merged)
    mats = [s.material for s in merged.material_slots if s.material]
    diff = p2_lib._img(tag + "_diff", 256, 256, 'sRGB')
    ao = p2_lib._img(tag + "_ao", 256, 256, 'Non-Color')
    bpy.ops.object.select_all(action='DESELECT')
    merged.select_set(True)
    bpy.context.view_layer.objects.active = merged
    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = True
    nodes = p2_lib._set_bake_target(mats, diff)
    sc.cycles.samples = 1
    bpy.ops.object.bake(type='DIFFUSE')
    p2_lib._clear_bake_targets(nodes)
    report(f"{tag} diffuse NO-AO: " + stats(diff))
    nodes = p2_lib._set_bake_target(mats, ao)
    sc.cycles.samples = 16
    bpy.ops.object.bake(type='AO')
    p2_lib._clear_bake_targets(nodes)
    report(f"{tag} AO raw: " + stats(ao))
    p2_lib._multiply_ao(diff, ao)
    report(f"{tag} diffuse AFTER AO multiply: " + stats(diff))
    bpy.data.objects.remove(merged)
    bpy.data.images.remove(diff); bpy.data.images.remove(ao)

seg = bpy.data.objects["rim_segment_00"]
bake_pair([seg], ["P2_basalt_plate", "P2_gunmetal", "P2_gunmetal_dark",
                  "MAT_amber_emit_soft", "MAT_dark_unlit"], "CMP_SEG")
gantry_objs = holder_meshes("witness-drydock-gantry")
# gantry holder is already baked (single BAKED mesh): bake it as-is for AO context comparison
bake_pair(gantry_objs, None, "CMP_GANTRY")
report("ao compare done")
