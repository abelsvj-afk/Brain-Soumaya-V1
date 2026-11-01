"""Pass 2 export + validation: two pilot GLBs, mechanical anchor diff,
bounding boxes from the exported files, tri/draw/file actuals, GLB texture
audit (count + max dimension + mime), cyan audit, text audit.
Writes pass2_validation.json. Adapted from pass-1 build_08."""
import bpy, sys, os, json, struct, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
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
    set_scene(scene)
    keep = set()
    for rn in root_names:
        o = bpy.data.objects.get(rn)
        if o:
            keep.add(o)
            keep.update(o.children_recursive)
    for o in bpy.data.objects:
        o.hide_render = o not in keep
        o.hide_viewport = o not in keep
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_visible=True,
                              export_cameras=False, export_lights=False,
                              export_yup=True, export_apply=True)
    for o in bpy.data.objects:
        o.hide_render = False
        o.hide_viewport = False
    js, binchunk = parse_glb(path)
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
    off = 20 + jlen
    blen = struct.unpack('<I', data[off:off + 4])[0]
    binchunk = data[off + 8:off + 8 + blen]
    return js, binchunk

def image_dims(mime, buf):
    if mime == 'image/png' and buf[:8] == b'\x89PNG\r\n\x1a\n':
        w, h = struct.unpack('>II', buf[16:24])
        return w, h
    if mime == 'image/jpeg' and buf[:2] == b'\xff\xd8':
        i = 2
        while i < len(buf) - 9:
            if buf[i] != 0xFF:
                i += 1
                continue
            marker = buf[i + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                h, w = struct.unpack('>HH', buf[i + 5:i + 9])
                return w, h
            seg = struct.unpack('>H', buf[i + 2:i + 4])[0]
            i += 2 + seg
    return None, None

def texture_audit(js, binchunk):
    out = []
    bvs = js.get('bufferViews', [])
    for img in js.get('images', []):
        bv = bvs[img['bufferView']]
        start = bv.get('byteOffset', 0)
        buf = binchunk[start:start + bv['byteLength']]
        w, h = image_dims(img.get('mimeType', ''), buf)
        out.append({"name": img.get('name'), "mime": img.get('mimeType'),
                    "w": w, "h": h, "bytes": bv['byteLength']})
    return out

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
    prims = 0
    for idx, n in enumerate(nodes):
        if 'mesh' not in n:
            continue
        mesh = meshes[n['mesh']]
        lo = Vector((1e18,) * 3); hi = Vector((-1e18,) * 3)
        for prim in mesh['primitives']:
            prims += 1
            acc = accessors[prim['attributes']['POSITION']]
            mn, mx = Vector(acc['min']), Vector(acc['max'])
            for cx in (mn.x, mx.x):
                for cy in (mn.y, mx.y):
                    for cz in (mn.z, mx.z):
                        p = world[idx] @ Vector((cx, cy, cz))
                        lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
            cnt = accessors[prim['indices']]['count'] if 'indices' in prim else acc['count']
            total_tris += cnt // 3
        out.setdefault(n.get('name', f'node{idx}'), []).append((lo, hi))
    return out, total_tris, [n.get('name') for n in nodes], prims

def aggregate_aabb(js, out, target):
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
js, binchunk = parse_glb(EXT_GLB)
out, tris, names, prims = glb_node_world_aabbs(js)
results['exterior'].update({'tris': tris, 'nodes': len(names), 'primitives': prims,
                            'anchors_missing': [n for n in EXPECTED_EXT if n not in names],
                            'forbidden_present': [n for n in names if n in ('REF_locked', 'CAMERAS_pilot')],
                            'textures': texture_audit(js, binchunk)})
for probe in ("station-rotating", "hero-ship", "witness-drydock-gantry", "backdrop-lava"):
    bb = aggregate_aabb(js, out, probe)
    if bb:
        lo, hi = bb
        results['exterior'][f'bbox_{probe}'] = {
            'min': [round(v, 1) for v in lo], 'max': [round(v, 1) for v in hi],
            'size': [round(hi[i] - lo[i], 1) for i in range(3)],
            'centre': [round((lo[i] + hi[i]) / 2, 1) for i in range(3)]}
report(f"EXTERIOR GLB {sz} bytes, {tris} tris, missing={results['exterior']['anchors_missing']}")

sz2 = export_scene(intr, ["station-interior"], INT_GLB, "station-world")
results['interior'] = {'path': INT_GLB, 'bytes': sz2}
js2, binchunk2 = parse_glb(INT_GLB)
out2, tris2, names2, prims2 = glb_node_world_aabbs(js2)
results['interior'].update({'tris': tris2, 'nodes': len(names2), 'primitives': prims2,
                            'anchors_missing': [n for n in EXPECTED_INT if n not in names2],
                            'textures': texture_audit(js2, binchunk2)})
bb = aggregate_aabb(js2, out2, "interior-bay-ship")
if bb:
    lo, hi = bb
    results['interior']['bbox_interior-bay-ship'] = {
        'centre': [round((lo[i] + hi[i]) / 2, 1) for i in range(3)],
        'size': [round(hi[i] - lo[i], 1) for i in range(3)]}
report(f"INTERIOR GLB {sz2} bytes, {tris2} tris, missing={results['interior']['anchors_missing']}")

for label, scene in (('exterior', ext), ('interior', intr)):
    raw, est = draw_estimate(scene)
    results[label]['mesh_objects_live'] = raw
    results[label]['draw_estimate_instanced'] = est
    report(f"{label}: live mesh objects={raw}, draw estimate={est}")

cyan_users = []
for o in bpy.data.objects:
    if o.type == 'MESH' and any(s.material and s.material.name == 'MAT_cyan_emit' for s in o.material_slots):
        cyan_users.append(o.name)
results['cyan_objects'] = sorted(cyan_users)
text_objs = [o.name for o in bpy.data.objects if o.type in ('FONT', 'TEXT')]
results['text_objects'] = text_objs
results['blend_images'] = [{"name": i.name, "size": list(i.size)} for i in bpy.data.images if i.size[0] > 0]
report(f"cyan users ({len(cyan_users)}): {sorted(set(cyan_users))}; text objects: {text_objs}")

with open(P2_DIR + "/pass2_validation.json", "w") as f:
    json.dump(results, f, indent=1)
save_master()
report("pass2 export + validation complete")
