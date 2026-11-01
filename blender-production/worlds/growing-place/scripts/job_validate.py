# Batch job: validate the exported Growing Place GLB in a CLEAN scene.
# Run via batch-run.sh <startup.blend> job_validate.py gp-validate
import bpy, json, os, math
from mathutils import Vector

OUT = os.environ["BATCH_OUT_DIR"]
GLB = "/home/hatch/workspace/Soumaya-Environment-Production/exports/growing-place.glb"

EXPECTED = [
    "growing-place",
    "witness-tree", "witness-halo",
    "terrace-0", "terrace-1", "terrace-2", "terrace-3", "terrace-4", "terrace-5",
    "terrace-riser-0", "terrace-riser-1", "terrace-riser-2",
    "terrace-riser-3", "terrace-riser-4", "terrace-riser-5",
    "grove-trees", "grove-trunks", "grove-lawns", "grove-flowers", "grove-trails",
    "grove-mist", "grove-pulse",
    "plots-gathering", "plots-sprout", "plots-stone", "plots-wild",
    "seed-pods", "paths", "lit-paths", "vegetation", "warm-halos",
    "garden-avatar", "garden-carried",
    "garden-underside-cap", "garden-underside-skirt",
    "backdrop-planets-set", "backdrop-quaternius-planet-2",
    "relic-witness-seed", "relic-dawn-leaf",
]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

names = [o.name for o in bpy.data.objects]
colls = [c.name for c in bpy.data.collections]
all_names = set(names) | set(colls)
missing = [e for e in EXPECTED if e not in all_names]

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
tris = 0
for o in meshes:
    me = o.data
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)

def world_bbox(objs):
    mn = Vector((1e18, 1e18, 1e18))
    mx = Vector((-1e18, -1e18, -1e18))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
            mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
    return mn, mx

mn, mx = world_bbox(meshes)
wt = bpy.data.objects.get("witness-tree")
wt_bbox = None
if wt is not None:
    kids = [o for o in bpy.data.objects if o.parent == wt or o.name.startswith("witness")]
    a, b = world_bbox(kids)
    wt_bbox = {"min": [round(v, 1) for v in a], "max": [round(v, 1) for v in b]}

# ---- re-import render (Cycles, low samples) + magenta check
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.device = 'CPU'
sc.render.resolution_x = 640
sc.render.resolution_y = 360
cd = bpy.data.cameras.new("val_cam")
co = bpy.data.objects.new("val_cam", cd)
co.location = (1500, -1500, 720)
d = Vector((0, 0, 40)) - co.location
co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
co.data.clip_end = 12000
sc.collection.objects.link(co)
sc.camera = co
sc.render.filepath = os.path.join(OUT, "reimport_overview.png")
bpy.ops.render.render(write_still=True)
img = bpy.data.images.load(sc.render.filepath)
px = img.pixels
mag = 0
tot = 0
step = 4 * 997
for i in range(0, len(px) - 3, step):
    r, g, b = px[i], px[i + 1], px[i + 2]
    tot += 1
    if r > 0.75 and b > 0.75 and g < 0.3:
        mag += 1
magenta_frac = mag / max(1, tot)
print("BATCH_OUTPUT " + sc.render.filepath)

res = {
    "glb": GLB,
    "glb_bytes": os.path.getsize(GLB),
    "expected": len(EXPECTED),
    "missing": missing,
    "mesh_objects": len(meshes),
    "total_objects": len(bpy.data.objects),
    "triangles": tris,
    "bbox_min": [round(v, 1) for v in mn],
    "bbox_max": [round(v, 1) for v in mx],
    "extent_xy": [round(mx.x - mn.x, 1), round(mx.y - mn.y, 1)],
    "z_range": [round(mn.z, 1), round(mx.z, 1)],
    "witness_bbox": wt_bbox,
    "magenta_fraction": round(magenta_frac, 5),
}
json.dump(res, open(os.path.join(OUT, "validation_results.json"), "w"), indent=1)
print("BATCH_SUMMARY missing=%d tris=%d meshes=%d magenta=%.4f" % (
    len(missing), tris, len(meshes), magenta_frac))
