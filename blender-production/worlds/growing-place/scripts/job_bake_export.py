# Batch job: bake all GP groups in a COPY of the master, rewire to baked
# materials, save a baked blend, export the Growing Place GLB.
# Run via tools/batch-blender/batch-run.sh <master-copy.blend> job_bake_export.py gp-bake
# CHECKPOINTED: after every group it rewrites bake_results.json and saves
# checkpoint.blend in the job out dir. Re-running the SAME job name resumes
# from the checkpoint and skips finished groups.
import bpy, json, os, sys

OUT = os.environ["BATCH_OUT_DIR"]
SCRIPTS = "/home/hatch/workspace/Soumaya-Environment-Production/worlds/growing-place/scripts"
registry = json.load(open(os.path.join(SCRIPTS, "bake_registry.json")))

CHECKPOINT = os.path.join(OUT, "checkpoint.blend")
RESULTS_PATH = os.path.join(OUT, "bake_results.json")

results = {}
if os.path.exists(CHECKPOINT):
    if os.path.exists(RESULTS_PATH):
        results = json.load(open(RESULTS_PATH))
    bpy.ops.wm.open_mainfile(filepath=CHECKPOINT)
    print("RESUMED from checkpoint with %d groups done" % len(results), flush=True)

sc = bpy.data.scenes["GROWING_PLACE"]
bpy.context.window.scene = sc
sc.render.engine = 'CYCLES'
sc.cycles.samples = 2  # colour/roughness passes only need the procedural evaluation; 8 samples was ~4x the cost for no visible gain
sc.cycles.device = 'CPU'
sc.render.bake.use_clear = True
sc.render.bake.margin = 6
sc.render.bake.use_pass_direct = False
sc.render.bake.use_pass_indirect = False
sc.render.bake.use_pass_color = True

def img_mean(img):
    px = img.pixels
    n = len(px)
    if n == 0:
        return 0.0
    step = max(1, (n // 4 // 20000)) * 4
    tot, cnt = 0.0, 0
    for i in range(0, n - 3, step):
        tot += (px[i] + px[i + 1] + px[i + 2]) / 3.0
        cnt += 1
    return tot / max(1, cnt)

def bake_pass(mat, img, bake_type):
    nt = mat.node_tree
    tgt = nt.nodes.get("BAKE_TGT")
    if tgt is None:
        tgt = nt.nodes.new('ShaderNodeTexImage')
        tgt.name = "BAKE_TGT"
    tgt.image = img
    for n in nt.nodes:
        n.select = (n == tgt)
    nt.nodes.active = tgt
    bpy.ops.object.bake(type=bake_type)

def checkpoint():
    json.dump(results, open(RESULTS_PATH, "w"), indent=1)
    bpy.ops.wm.save_as_mainfile(filepath=CHECKPOINT)
    print("CHECKPOINT saved (%d groups)" % len(results), flush=True)

for key in sorted(registry.keys()):
    if key in results and "diff_mean" in results[key]:
        print("SKIP (already baked)", key, flush=True)
        continue
    grp = registry[key]
    mat = bpy.data.materials.get(grp["material"])
    objs = [bpy.data.objects[n] for n in grp["objects"] if bpy.data.objects.get(n)]
    if mat is None or not objs:
        results[key] = {"error": "missing material or objects"}
        checkpoint()
        continue
    size = int(grp["size"])
    di = bpy.data.images.new("GPB_%s_diff" % key, size, size)
    ri = bpy.data.images.new("GPB_%s_rough" % key, size, size)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bake_pass(mat, di, 'DIFFUSE')
    bake_pass(mat, ri, 'ROUGHNESS')
    di.pack()
    ri.pack()
    md, mr = img_mean(di), img_mean(ri)
    results[key] = {"size": size, "objects": [o.name for o in objs],
                    "diff_mean": round(md, 4), "rough_mean": round(mr, 4),
                    "black_bake": bool(md < 0.01)}
    print("BAKED", key, "diff_mean", round(md, 4), "rough_mean", round(mr, 4), flush=True)
    # rewire to the baked pair
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    td = nt.nodes.new('ShaderNodeTexImage'); td.image = di
    ri.colorspace_settings.name = 'Non-Color'
    tr = nt.nodes.new('ShaderNodeTexImage'); tr.image = ri
    nt.links.new(td.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(tr.outputs['Color'], bsdf.inputs['Roughness'])
    if mat.name == "GP_hull":
        bsdf.inputs['Metallic'].default_value = 0.15
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    checkpoint()

baked_path = os.path.join(OUT, "growing-place-baked.blend")
bpy.ops.wm.save_as_mainfile(filepath=baked_path)
print("BATCH_OUTPUT " + baked_path)

# ---- export: only the growing-place root subtree
root = sc.collection.children.get("growing-place")
keep = set()
def collect(coll):
    for o in coll.objects:
        keep.add(o)
    for ch in coll.children:
        collect(ch)
collect(root)
bpy.ops.object.select_all(action='DESELECT')
for o in keep:
    o.select_set(True)
glb_path = os.path.join(OUT, "growing-place.glb")
bpy.ops.export_scene.gltf(filepath=glb_path, use_selection=True,
                          export_apply=True, export_yup=True)
print("BATCH_OUTPUT " + glb_path)
print("BATCH_SUMMARY groups=%d black=%d" % (
    len(results), sum(1 for v in results.values() if v.get("black_bake"))))
