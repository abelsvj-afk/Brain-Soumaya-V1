"""Shared helpers for the Great Station pilot build.
Coordinate convention: Blender Z-up exports to glTF/Three Y-up.
Three.js (x, y, z) -> Blender (x, -z, y). All holder Empties sit at origin;
children carry world coordinates, so a holder's bounds = its geometry bounds.
"""
import bpy
import math
from mathutils import Vector

GS_DIR = "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station"
MASTER = "/home/hatch/workspace/Soumaya-Environment-Production/source/soumaya_worlds_master.blend"

# ---------- materials ----------
def make_mat(name, base, metallic=0.0, roughness=0.6, emission=None, emission_strength=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if emission is not None:
        if "Emission Color" in bsdf.inputs:
            bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return m

def hexcol(h):
    return tuple(((h >> s) & 0xFF) / 255.0 for s in (16, 8, 0))

BASALT   = hexcol(0x2b2e35)
GUNMETAL = hexcol(0x3d4149)
AMBER    = hexcol(0xffb454)
CYAN     = hexcol(0x9fd8e8)
INDIGO   = hexcol(0x0b1026)

def build_materials():
    mats = {}
    mats['basalt']        = make_mat("MAT_basalt", BASALT, metallic=0.35, roughness=0.85)
    mats['basalt_light']  = make_mat("MAT_basalt_light", (0.24, 0.25, 0.29), metallic=0.3, roughness=0.8)
    mats['gunmetal']      = make_mat("MAT_gunmetal", GUNMETAL, metallic=0.75, roughness=0.5)
    mats['gunmetal_dark'] = make_mat("MAT_gunmetal_dark", (0.13, 0.14, 0.16), metallic=0.7, roughness=0.55)
    mats['seam_old']      = make_mat("MAT_seam_old", (0.10, 0.09, 0.08), metallic=0.4, roughness=0.95)
    mats['amber_emit']    = make_mat("MAT_amber_emit", (0.2, 0.12, 0.03), emission=AMBER, emission_strength=3.2)
    mats['amber_soft']    = make_mat("MAT_amber_emit_soft", (0.15, 0.09, 0.02), emission=AMBER, emission_strength=1.4)
    mats['cyan_emit']     = make_mat("MAT_cyan_emit", (0.05, 0.12, 0.14), emission=CYAN, emission_strength=3.5)
    mats['dark']          = make_mat("MAT_dark_unlit", (0.02, 0.02, 0.025), metallic=0.2, roughness=0.9)
    mats['glass']         = make_mat("MAT_glass", (0.05, 0.08, 0.12), metallic=0.1, roughness=0.15)
    mats['hull_white']    = make_mat("MAT_hull_pale", (0.62, 0.64, 0.66), metallic=0.45, roughness=0.45)
    mats['interior_wall'] = make_mat("MAT_interior_wall", (0.36, 0.35, 0.33), metallic=0.25, roughness=0.7)
    mats['interior_floor']= make_mat("MAT_interior_floor", (0.16, 0.16, 0.18), metallic=0.4, roughness=0.6)
    mats['wood_warm']     = make_mat("MAT_wood_warm", (0.32, 0.2, 0.1), metallic=0.0, roughness=0.8)
    mats['paper_pale']    = make_mat("MAT_paper_pale", (0.75, 0.7, 0.6), metallic=0.0, roughness=0.9)
    return mats

# ---------- scene / collection / anchor plumbing ----------
def get_or_create_scene(name):
    sc = bpy.data.scenes.get(name)
    if sc is None:
        sc = bpy.data.scenes.new(name)
    return sc

def _all_parent_candidates(scene):
    parents = [scene.collection] + list(bpy.data.collections)
    for sc in bpy.data.scenes:
        parents.append(sc.collection)
    return parents

def ensure_collection(scene, name, parent_coll):
    """Return collection `name`, parented under parent_coll (a Collection)."""
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
    if c == parent_coll:
        return c
    if c.name not in [ch.name for ch in parent_coll.children]:
        for p in _all_parent_candidates(scene):
            if p != parent_coll and c.name in [ch.name for ch in p.children]:
                p.children.unlink(c)
        parent_coll.children.link(c)
    return c

def get_collection(scene, name, parent_coll=None):
    root = parent_coll if parent_coll is not None else scene.collection
    return ensure_collection(scene, name, root)

def make_anchor(scene, root_coll_name, name, parent_name=None):
    """Create collection + Empty for a holder. Returns the Empty."""
    root = ensure_collection(scene, root_coll_name, scene.collection)
    if parent_name and parent_name != name:
        parent_coll = ensure_collection(scene, parent_name, root)
        parent_obj = bpy.data.objects.get(parent_name)
    else:
        parent_coll = root
        parent_obj = bpy.data.objects.get(root_coll_name)
    coll = ensure_collection(scene, name, parent_coll)
    obj = bpy.data.objects.get(name)
    if obj is None:
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_type = 'PLAIN_AXES'
        obj.empty_display_size = 2.0
    if obj.name not in [o.name for o in coll.objects]:
        coll.objects.link(obj)
    if parent_obj is not None and obj.parent is None and obj != parent_obj:
        obj.parent = parent_obj
    return obj

def root_anchor(scene, name):
    coll = ensure_collection(scene, name, scene.collection)
    obj = bpy.data.objects.get(name)
    if obj is None:
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_type = 'PLAIN_AXES'
        obj.empty_display_size = 3.0
        coll.objects.link(obj)
    return obj

def put(obj, anchor_name, coll_scene=None):
    """Parent obj under anchor Empty (origin => keep world transform) and move to anchor collection."""
    anchor = bpy.data.objects[anchor_name]
    obj.parent = anchor
    coll = bpy.data.collections.get(anchor_name)
    if coll is not None:
        # unlink from all other collections
        for c in list(obj.users_collection):
            if c != coll:
                c.objects.unlink(obj)
        if obj.name not in [o.name for o in coll.objects]:
            coll.objects.link(obj)
    return obj

def assign(obj, mat):
    if mat is None:
        return obj
    if obj.data and hasattr(obj.data, 'materials'):
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    return obj

# ---------- primitive builders (world-space coords, Blender Z-up) ----------
def box(name, dims, loc, mat=None, anchor=None, rot=(0, 0, 0), bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.dimensions = dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = o.modifiers.new("bev", 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    if mat: assign(o, mat)
    if anchor: put(o, anchor)
    return o

def cyl(name, radius, depth, loc, mat=None, anchor=None, rot=(0, 0, 0), verts=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    if mat: assign(o, mat)
    if anchor: put(o, anchor)
    return o

def sphere(name, radius, loc, mat=None, anchor=None, seg=24, rings=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=radius, location=loc)
    o = bpy.context.active_object
    o.name = name
    for p in o.data.polygons:
        p.use_smooth = True
    if mat: assign(o, mat)
    if anchor: put(o, anchor)
    return o

def cone(name, r1, r2, depth, loc, mat=None, anchor=None, rot=(0, 0, 0), verts=16):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    if mat: assign(o, mat)
    if anchor: put(o, anchor)
    return o

def hull(name, length, mat=None, anchor=None, loc=(0, 0, 0), rot=(0, 0, 0), beam_ratio=0.30, height_ratio=0.24):
    """Clean elongated hull: diamond cross-section, tapered nose (+X forward)."""
    import bmesh
    L = length / 2.0
    W = length * beam_ratio / 2.0
    H = length * height_ratio / 2.0
    # stations along X: (x, half-width, half-height, y-off)
    stations = [
        (-L,        W * 0.55, H * 0.55),
        (-L * 0.55, W,        H),
        ( L * 0.25, W * 0.92, H * 0.9),
        ( L * 0.75, W * 0.45, H * 0.5),
        ( L,        0.001,    0.001),
    ]
    verts, faces = [], []
    rings = []
    for (x, w, h) in stations:
        ring = []
        for (dy, dz) in ((0, h), (w, 0), (0, -h), (-w, 0)):
            ring.append(len(verts))
            verts.append((x, dy, dz))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            faces.append((a[k], b[k], b[(k + 1) % 4], a[(k + 1) % 4]))
    faces.append(tuple(reversed(rings[0])))
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    o = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    for p in mesh.polygons:
        p.use_smooth = True
    if mat: assign(o, mat)
    if anchor: put(o, anchor)
    return o

def bounds_of(obj):
    """World-space AABB (min,max) of an object incl. children, evaluated."""
    dg = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e18, 1e18, 1e18)); hi = Vector((-1e18, -1e18, -1e18))
    objs = [obj] + list(obj.children_recursive)
    found = False
    for o in objs:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        for c in ev.bound_box:
            p = ev.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
            found = True
    if not found:
        return None
    return lo, hi

def save_master():
    bpy.ops.wm.save_as_mainfile(filepath=MASTER)

def report(msg):
    print("GS>> " + str(msg))
