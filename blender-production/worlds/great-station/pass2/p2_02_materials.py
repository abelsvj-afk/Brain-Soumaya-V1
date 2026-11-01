"""Pass 2 step 1: P2 procedural materials + remap + sun consolidation + test render."""
import bpy, sys, os, math
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from p2_lib import *

ext = bpy.data.scenes["STATION_EXTERIOR"]
intr = bpy.data.scenes["STATION_INTERIOR"]

mats = build_p2_materials()
report(f"P2 materials: {sorted(m.name for m in bpy.data.materials if m.name.startswith('P2_'))}")

for sc in (ext, intr):
    n = remap_materials(sc)
    report(f"{sc.name}: remapped {n} material slots")

# ---- sun consolidation: three coincident SUN_cold_key copies -> one ----
suns = [o for o in bpy.data.objects if o.type == 'LIGHT' and o.data.type == 'SUN' and o.name.startswith("SUN_cold_key")]
rots = {tuple(round(v, 3) for v in o.rotation_euler) for o in suns}
total = sum(o.data.energy for o in suns)
report(f"cold-key suns: {[(o.name, round(o.data.energy,2)) for o in suns]} rotations identical: {len(rots)==1}")
if len(suns) > 1 and len(rots) == 1:
    keep = bpy.data.objects["SUN_cold_key"]
    keep.data.energy = total
    for o in suns:
        if o is not keep:
            bpy.data.objects.remove(o, do_unlink=True)
    report(f"consolidated suns -> SUN_cold_key energy {total:.2f}")

# ---- exterior world: lift the indigo ambient slightly so surfaces read ----
w = ext.world
if w and w.use_nodes:
    bg = w.node_tree.nodes.get("Background")
    if bg:
        report(f"world bg: color={tuple(round(c,3) for c in bg.inputs[0].default_value)} strength={bg.inputs[1].default_value}")
        bg.inputs[1].default_value = 0.85

# warm bounce sun (planet/station amber bounce) at low energy
if not bpy.data.objects.get("SUN_warm_bounce"):
    ld = bpy.data.lights.new("SUN_warm_bounce", 'SUN')
    ld.energy = 0.55
    ld.color = (1.0, 0.78, 0.55)
    o = bpy.data.objects.new("SUN_warm_bounce", ld)
    ext.collection.objects.link(o)
    o.rotation_euler = (math.radians(-35), 0, math.radians(140))
    report("added SUN_warm_bounce energy 0.55")

save_master()
bpy.ops.wm.save_as_mainfile(filepath="/home/hatch/workspace/Soumaya-Environment-Production/source/pass2-backups/soumaya_worlds_master_p2-02-materials.blend")
bpy.ops.wm.open_mainfile(filepath=MASTER)
report("saved master + p2-02 backup")

# ---- quick test render: cam02 at 50% ----
ext = bpy.data.scenes["STATION_EXTERIOR"]
bpy.context.window.scene = ext
ext.render.resolution_percentage = 50
ext.camera = bpy.data.objects["cam02_ring_harbor_closeup"]
ext.render.filepath = P2_DIR + "/test_cam02_materials.png"
bpy.ops.render.render(write_still=True)
report("test render: " + ext.render.filepath + f" ({os.path.getsize(ext.render.filepath)} B)")
ext.render.resolution_percentage = 100
