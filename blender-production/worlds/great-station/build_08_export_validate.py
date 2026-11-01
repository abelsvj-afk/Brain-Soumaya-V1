"""Stage C step 8 (build order step 10): export two pilot GLBs + validation.
- Exterior GLB from STATION_EXTERIOR (anchor collections only; REF_locked and
  CAMERAS_pilot excluded, cameras/lights not exported).
- Interior GLB from STATION_INTERIOR.
Validation: node-name diff vs the §1.8 anchor list, world AABBs recomputed
FROM THE EXPORTED GLB (accessor min/max x node world matrix), tri counts,
draw-call estimate (distinct mesh+material combos, linked-duplicate sets = 1),
cyan audit (objects using the cyan material), mystery sign-offs.
Writes validation_results.json next to this script."""
import bpy, sys, os, json, struct
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *
from mathutils import Vector, Matrix

EXPORTS = "/home/hatch/workspace/Soumaya-Environment-Production/exports"
EXT_GLB = EXPORTS + "/great-station-pilot.glb"
INT_GLB = EXPORTS + "/great-station-interior-pilot.glb"

EXPECTED_EXT = ["station-world", "station-rotating", "station-work-lights", "station-traffic-fallback",
    "witness-drydock-gantry", "witness-hauler", "annex-lunar-annex", "annex-colony-ring",
    "annex-station-stores", "annex-model-lunar-annex", "annex-model-colony-ring",
    "annex-model-station-stores", "hero-ship", "backdrop-lava", "backdrop-quaternius-planet-1",
    "docking-shuttle", "harbor-controller-ship",
    "traffic-01", "traffic-02", "traffic-03", "traffic-04", "traffic-05", "traffic-06",
    "docked-01", "docked-02", "docked-03", "drydock-main", "drydock-witness",
    "dressing-drydock", "dressing-annex", "relic-mounts", "star_dome"]
EXPECTED_INT = ["station-interior", "hangar-bay", "commission-board", "fleet-deck", "observation-deck",
    "interior-bay-ship", "interior-user-ship", "interior-bay-door-lintel",
    "interior-deck-viewport-lintel", "interior-gate-lintel", "interior-gate-lights",
    "interior-rim-arc", "interior-nav-markers", "interior-work-lights", "interior-light-strips",
    "interior-model-fleet-1", "interior-model-fleet-2",
    "interior-floor-hangar-bay", "interior-floor-commission-board", "interior-floor-fleet-deck",
    "interior-floor-observation-deck", "interior-ceiling-hangar-bay",
    "interior-ceiling-commission-board", "interior-ceiling-fleet-deck", "interior-ceiling-observation-deck"]

def export_scene(scene, root_names, path, forbidden_root):
    bpy.context.window.scene = scene
    keep = set()
    for rn in root_names:
        o = bpy.data.objects.get(rn)
        if o:
            keep.add(o)
            keep.update(o.children_recursive)
    # NOTE: this exporter build IGNORES use_selection (proven by probe: a clean
    # exterior-only selection still exported both scenes). use_visible + global
    # hide flags is the reliable gate. Hide flags are file-global, so hide
    # non-keep objects across ALL scenes, then restore everything.
    for o in bpy.data.objects:
        o.hide_render = o not in keep
        o.hide_viewport = o not in keep
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_visible=True,
                              export_cameras=False, export_lights=False,
                              export_yup=True, export_apply=True)
    for o in bpy.data.objects:
        o.hide_render = False
        o.hide_viewport = False
    # verify what actually landed in the file
    js = parse_glb(path)
    names = [n.get('name') for n in js.get('nodes', [])]
    assert forbidden_root not in names, f"{path} wrongly contains {forbidden_root}"
    assert root_names[0] in names, f"{path} missing root {root_names[0]}"
    report(f"verified {path.split('/')[-1]}: root {root_names[0]} present, {forbidden_root} absent, {len(names)} nodes")
    return os.path.getsize(path)

def parse_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    assert data[:4] == b'glTF'
    jlen = struct.unpack('<I', data[12:16])[0]
    js = json.loads(data[20:20 + jlen])
    return js

def glb_node_world_aabbs(js):
    nodes = js.get('nodes', [])
    meshes = js.get('meshes', [])
    accessors = js.get('accessors', [])
    def local_mat(n):
        if 'matrix' in n:
            m = n['matrix']
            return Matrix(((m[0], m[4], m[8], m[12]), (m[1], m[5], m[9], m[13]),
                           (m[2], m[6], m[10], m[14]), (m[3], m[7], m[11], m[15])))
        loc = Vector(n.get('translation', [0, 0, 0]))
        rot = n.get('rotation', [0, 0, 0, 1])
        from mathutils import Quaternion
        q = Quaternion((rot[3], rot[0], rot[1], rot[2]))
        scl = Vector(n.get('scale', [1, 1, 1]))
        return Matrix.LocRotScale(loc, q, scl)
    world = {}
    def walk(idx, parent_m):
        n = nodes[idx]
        m = parent_m @ local_mat(n)
        world[idx] = m
        for c in n.get('children', []):
            walk(c, m)
    for s in js.get('scenes', []):
        for r in s.get('nodes', []):
            walk(r, Matrix.Identity(4))
    out = {}
    total_tris = 0
    for idx, n in enumerate(nodes):
        if 'mesh' not in n:
            continue
        mesh = meshes[n['mesh']]
        lo = Vector((1e18,) * 3); hi = Vector((-1e18,) * 3)
        for prim in mesh['primitives']:
            acc = accessors[prim['attributes']['POSITION']]
            mn, mx = Vector(acc['min']), Vector(acc['max'])
            for cx in (mn.x, mx.x):
                for cy in (mn.y, mx.y):
                    for cz in (mn.z, mx.z):
                        p = world[idx] @ Vector((cx, cy, cz))
                        lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
            cnt = accessors[prim['indices']]['count'] if 'indices' in prim else acc['count']
            total_tris += cnt // 3
        # aggregate up the ancestor chain by node name chain: store per-node own AABB
        out.setdefault(n.get('name', f'node{idx}'), []).append((lo, hi))
    return out, total_tris, [n.get('name') for n in nodes]

def aggregate_aabb(js, out, target):
    """Union AABB of all mesh nodes in the subtree of node named `target` (glTF Y-up coords)."""
    nodes = js.get('nodes', [])
    name2idx = {n.get('name'): i for i, n in enumerate(nodes)}
    if target not in name2idx:
        return None
    lo = Vector((1e18,) * 3); hi = Vector((-1e18,) * 3)
    found = False
    stack = [name2idx[target]]
    while stack:
        i = stack.pop()
        n = nodes[i]
        nm = n.get('name')
        if nm in out:
            for (l, h) in out[nm]:
                lo = Vector(map(min, lo, l)); hi = Vector(map(max, hi, h)); found = True
        stack.extend(n.get('children', []))
    return (lo, hi) if found else None

results = {}
ext = bpy.data.scenes["STATION_EXTERIOR"]
intr = bpy.data.scenes["STATION_INTERIOR"]

sz = export_scene(ext, ["station-world"], EXT_GLB, "station-interior")
results['exterior'] = {'path': EXT_GLB, 'bytes': sz}
js = parse_glb(EXT_GLB)
out, tris, names = glb_node_world_aabbs(js)
results['exterior']['tris'] = tris
results['exterior']['nodes'] = len(names)
missing = [n for n in EXPECTED_EXT if n not in names]
extra_top = [n for n in names if n in ('REF_locked', 'CAMERAS_pilot')]
results['exterior']['anchors_missing'] = missing
results['exterior']['forbidden_present'] = extra_top
for probe in ("station-rotating", "hero-ship", "witness-drydock-gantry", "backdrop-lava"):
    bb = aggregate_aabb(js, out, probe)
    if bb:
        lo, hi = bb
        results['exterior'][f'bbox_{probe}'] = {
            'min': [round(v, 1) for v in lo], 'max': [round(v, 1) for v in hi],
            'size': [round(hi[i] - lo[i], 1) for i in range(3)],
            'centre': [round((lo[i] + hi[i]) / 2, 1) for i in range(3)]}
report(f"EXTERIOR GLB {sz} bytes, {tris} tris, anchors missing={missing}")

sz2 = export_scene(intr, ["station-interior"], INT_GLB, "station-world")
results['interior'] = {'path': INT_GLB, 'bytes': sz2}
js2 = parse_glb(INT_GLB)
out2, tris2, names2 = glb_node_world_aabbs(js2)
results['interior']['tris'] = tris2
results['interior']['nodes'] = len(names2)
results['interior']['anchors_missing'] = [n for n in EXPECTED_INT if n not in names2]
bb = aggregate_aabb(js2, out2, "interior-bay-ship")
if bb:
    lo, hi = bb
    results['interior']['bbox_interior-bay-ship'] = {
        'centre': [round((lo[i] + hi[i]) / 2, 1) for i in range(3)],
        'size': [round(hi[i] - lo[i], 1) for i in range(3)]}
report(f"INTERIOR GLB {sz2} bytes, {tris2} tris, anchors missing={results['interior']['anchors_missing']}")

# ---- draw-call estimate + cyan audit (from the live scene) ----
def draw_estimate(scene):
    combos = set()
    raw = 0
    for o in scene.objects:
        if o.type == 'MESH':
            raw += 1
            mats = tuple(s.material.name if s.material else '' for s in o.material_slots)
            combos.add((o.data.name, mats))
    return raw, len(combos)
for label, scene in (('exterior', ext), ('interior', intr)):
    raw, est = draw_estimate(scene)
    results[label]['mesh_objects'] = raw
    results[label]['draw_estimate_instanced'] = est
    report(f"{label}: mesh objects={raw}, draw estimate (mesh+material sets)={est}")

cyan_users = []
for o in bpy.data.objects:
    if o.type == 'MESH' and any(s.material and s.material.name == 'MAT_cyan_emit' for s in o.material_slots):
        cyan_users.append(o.name)
results['cyan_objects'] = sorted(cyan_users)
report(f"cyan material users ({len(cyan_users)}): {sorted(set(cyan_users))}")

with open("/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/validation_results.json", "w") as f:
    json.dump(results, f, indent=1)
save_master()
report("export + validation complete; results JSON written")
