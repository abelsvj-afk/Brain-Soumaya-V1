"""Pass 2 step 3b: annex architecture (walkways, door frames, window bands,
roof gear, braces, crane) + ship detail (fins, engine housings, panel strips,
docking arms, cargo pods, antennas). Hero/bay-ship hull length unchanged."""
import bpy, sys, math, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
from mathutils import Vector, Matrix

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
bpy.context.view_layer.update()
mats = build_p2_materials()
AMBER_SOFT = bpy.data.materials["MAT_amber_emit_soft"]
DARK = bpy.data.materials["MAT_dark_unlit"]
CYAN = bpy.data.materials["MAT_cyan_emit"]

def beam(name, a, b, t, mat, anchor):
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2; d = b - a
    o = box(name, (d.length, t, t), tuple(mid), mat=mat, anchor=anchor)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(d.normalized())
    return o

def tube(name, a, b, r, mat, anchor, verts=14):
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2; d = b - a
    o = cyl(name, r, d.length, tuple(mid), mat=mat, anchor=anchor, verts=verts)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return o

def _reparent_local(o, hull_obj, loc, rot):
    o.parent = hull_obj
    o.matrix_parent_inverse = Matrix.Identity(4)
    o.location = loc
    o.rotation_euler = rot
    coll = bpy.data.collections.get(hull_obj.parent.name)
    if coll and o.name not in [x.name for x in coll.objects]:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    return o

def hull_child(hull_obj, name, dims, loc, mat, rot=(0, 0, 0)):
    """Box authored in the hull's local space, parented to the hull."""
    o = box(name, dims, (0, 0, 0), mat=mat, anchor=None)
    return _reparent_local(o, hull_obj, loc, rot)

def hull_cyl(hull_obj, name, r, depth, loc, mat, rot=(0, 0, 0), verts=16):
    o = cyl(name, r, depth, (0, 0, 0), mat=mat, anchor=None, verts=verts)
    return _reparent_local(o, hull_obj, loc, rot)

# ================= LUNAR ANNEX =================
LA = "annex-lunar-annex"
tube("lunar_walkway", (-184.0, 110.0, 3.2), (-174.0, 117.0, 3.2), 1.7, mats['gunmetal'], LA)
for t in (0.25, 0.5, 0.75):
    p = Vector((-184.0, 110.0, 3.2)).lerp(Vector((-174.0, 117.0, 3.2)), t)
    bpy.ops.mesh.primitive_torus_add(major_radius=1.85, minor_radius=0.18, major_segments=16, minor_segments=6,
                                     location=tuple(p))
    ring = bpy.context.view_layer.objects.active
    ring.name = f"lunar_walkway_rib_{int(t*100)}"
    ring.rotation_mode = 'QUATERNION'
    ring.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(Vector((10, 7, 0)).normalized())
    assign(ring, mats['gunmetal_dark']); put(ring, LA)
# door frame + step (door itself already exists, blank and dark)
box("lunar_door_frame_a", (0.65, 0.65, 5.8), (-172.1, 101.2, 2.9), mat=mats['gunmetal'], anchor=LA)
box("lunar_door_frame_b", (0.65, 0.65, 5.8), (-167.9, 101.2, 2.9), mat=mats['gunmetal'], anchor=LA)
box("lunar_door_lintel", (4.9, 0.65, 0.65), (-170.0, 101.2, 5.9), mat=mats['gunmetal'], anchor=LA)
box("lunar_door_step", (4.6, 1.8, 0.5), (-170.0, 100.2, 0.25), mat=mats['gunmetal_dark'], anchor=LA)
# dome windows (front hemisphere, amber) — placed on sphere surface, facing out
def dome_windows(prefix, centre, r, count_elevs, anchor):
    n = 0
    for elev_deg, azims in count_elevs:
        el = math.radians(elev_deg)
        for az in azims:
            a = math.radians(az)
            nrm = Vector((math.cos(el) * math.sin(a), -math.cos(el) * math.cos(a), math.sin(el)))
            pos = Vector(centre) + nrm * (r + 0.06)
            o = box(f"{prefix}_win_{n}", (1.25, 0.22, 0.68), tuple(pos), mat=AMBER_SOFT, anchor=anchor)
            o.rotation_mode = 'QUATERNION'
            o.rotation_quaternion = Vector((0, 1, 0)).rotation_difference(nrm)
            n += 1
    return n
dome_windows("lunarA", (-170.0, 120.0, 0.0), 13.0, [(28, (-38, -13, 13, 38)), (52, (-24, 0, 24))], LA)
dome_windows("lunarB", (-152.0, 132.0, 0.0), 9.0, [(30, (-25, 8)), (55, (-6,))], LA)
# roof/base gear + pipe run
box("lunar_vent", (2.6, 2.2, 1.6), (-184.0, 132.0, 2.8), mat=mats['gunmetal'], anchor=LA, bevel=0.15)
cyl("lunar_tank_small", 1.15, 3.4, (-158.0, 106.0, 3.7), mat=mats['basalt_light'], anchor=LA, verts=14)
cyl("lunar_antenna", 0.09, 3.4, (-186.0, 108.0, 13.4), mat=mats['gunmetal'], anchor=LA, verts=6)
tube("lunar_pipe", (-190.0, 101.6, 1.3), (-150.0, 101.6, 1.3), 0.3, mats['gunmetal_dark'], LA, verts=8)

# ================= COLONY RING =================
CR = "annex-colony-ring"
for k in range(14):
    a = math.radians(k * (360 / 14) + 8)
    pos = (-235.0 + 20.25 * math.cos(a), 30.0 + 20.25 * math.sin(a), 12.0)
    box(f"colony_win_{k}", (0.3, 1.5, 0.75), pos, mat=AMBER_SOFT, anchor=CR, rot=(0, 0, a))
for k in range(4):
    a = math.radians(k * 90 + 45)
    sx, sy = -235.0 + 6.5 * math.cos(a), 30.0 + 6.5 * math.sin(a)
    tube(f"colony_conduit_{k}", (sx, sy, 13.3), (-235.0 + 16.5 * math.cos(a), 30.0 + 16.5 * math.sin(a), 13.3),
         0.2, mats['gunmetal_dark'], CR, verts=6)
    fx, fy = -235.0 + 13.0 * math.cos(a), 30.0 + 13.0 * math.sin(a)
    box(f"colony_foot_{k}", (3.4, 3.4, 0.7), (fx, fy, 0.35), mat=mats['gunmetal_dark'], anchor=CR)
beam("colony_brace_a", (-227.0, 38.0, 0.6), (-243.0, 22.0, 8.6), 0.4, mats['gunmetal_dark'], CR)
beam("colony_brace_b", (-243.0, 38.0, 0.6), (-227.0, 22.0, 8.6), 0.4, mats['gunmetal_dark'], CR)
cyl("colony_antenna", 0.1, 4.2, (-235.0, 30.0, 17.0), mat=mats['gunmetal'], anchor=CR, verts=6)
box("colony_roofbox", (3.6, 3.0, 1.6), (-231.0, 33.0, 15.4), mat=mats['gunmetal'], anchor=CR, bevel=0.12)
box("colony_door_frame_a", (0.6, 0.6, 5.4), (-236.9, 19.2, 2.7), mat=mats['gunmetal'], anchor=CR)
box("colony_door_frame_b", (0.6, 0.6, 5.4), (-233.1, 19.2, 2.7), mat=mats['gunmetal'], anchor=CR)
box("colony_door_lintel", (4.4, 0.6, 0.6), (-235.0, 19.2, 5.6), mat=mats['gunmetal'], anchor=CR)

# ================= STATION STORES =================
SS = "annex-station-stores"
box("stores_walkway_roof", (17.0, 5.4, 0.5), (-127.0, 181.5, 6.4), mat=mats['gunmetal_dark'], anchor=SS)
for i, (x, y) in enumerate(((-134.0, 179.4), (-120.0, 179.4), (-134.0, 183.6), (-120.0, 183.6))):
    box(f"stores_walkway_post_{i}", (0.45, 0.45, 6.2), (x, y, 3.1), mat=mats['gunmetal'], anchor=SS)
cyl("stores_vent_a", 0.95, 1.7, (-142.0, 188.0, 11.9), mat=mats['gunmetal'], anchor=SS, verts=12)
cyl("stores_vent_b", 0.8, 1.4, (-133.0, 181.0, 11.7), mat=mats['gunmetal_dark'], anchor=SS, verts=12)
box("stores_roofbox", (3.4, 2.8, 1.5), (-118.0, 174.0, 8.8), mat=mats['gunmetal'], anchor=SS, bevel=0.12)
tube("stores_pipe_down", (-139.0, 190.4, 13.6), (-139.0, 190.4, 2.0), 0.34, mats['gunmetal_dark'], SS, verts=8)
tube("stores_pipe_top", (-146.0, 190.4, 13.6), (-139.0, 190.4, 13.6), 0.34, mats['gunmetal_dark'], SS, verts=8)
# dock crane
box("stores_crane_post", (0.75, 0.75, 7.2), (-122.0, 175.5, 3.6), mat=mats['gunmetal'], anchor=SS)
beam("stores_crane_jib", (-122.0, 175.5, 7.1), (-116.5, 171.5, 8.0), 0.5, mats['gunmetal'], SS)
tube("stores_crane_cable", (-117.2, 172.2, 7.9), (-117.2, 172.2, 4.6), 0.07, DARK, SS, verts=6)
box("stores_crane_hook", (0.8, 0.8, 0.9), (-117.2, 172.2, 4.1), mat=mats['basalt_light'], anchor=SS)
for i, (dims, loc) in enumerate((((2.8, 2.2, 2.0), (-112.0, 172.0, 1.0)), ((2.8, 2.2, 2.0), (-112.0, 172.0, 3.0)),
                                 ((2.2, 1.8, 1.6), (-108.5, 174.5, 0.8)))):
    box(f"stores_crate_{i}", dims, loc, mat=mats['basalt_light'] if i < 2 else mats['gunmetal'], anchor=SS, bevel=0.08)
# second window row on slab A
for i, x in enumerate((-142.8, -139.6, -136.4, -133.2)):
    box(f"stores_win2_{i}", (1.5, 0.25, 0.8), (x, 176.7, 5.6), mat=AMBER_SOFT, anchor=SS)

# ================= ANNEX MODELS (representative modules) =================
for key in ("lunar-annex", "colony-ring", "station-stores"):
    holder = f"annex-model-{key}"
    hs = holder_meshes(holder)
    if hs:
        c = Vector((0, 0, 0))
        for o in hs:
            c += Vector(o.location)
        c /= len(hs)
        top = max(o.location.z + o.dimensions.z / 2 for o in hs)
        box(f"model_{key}_door", (1.1, 0.2, 1.9), (c.x + 1.8, c.y - 2.2, 1.0), mat=DARK, anchor=holder)
        box(f"model_{key}_win", (1.3, 0.2, 0.5), (c.x - 0.6, c.y - 2.2, 1.7), mat=AMBER_SOFT, anchor=holder)
        box(f"model_{key}_roof", (1.6, 1.4, 0.6), (c.x, c.y, top + 0.3), mat=mats['gunmetal'], anchor=holder)

# ================= SHIPS =================
def detail_hull(hull_obj, fin_scale=1.0, pods=False):
    """Local-space detail parented to a gs_lib.hull() object (nose +X)."""
    L = hull_obj.dimensions.x
    out = []
    if hull_obj.scale != Vector((1, 1, 1)):
        report(f"WARN {hull_obj.name} scale {hull_obj.scale[:]} — local detail may misplace")
    out.append(hull_child(hull_obj, hull_obj.name + "_fin_top", (2.6 * fin_scale, 0.16, 1.25 * fin_scale),
                          (-L * 0.36, 0, hull_obj.dimensions.z * 0.42), mats['gunmetal'],
                          rot=(0, math.radians(-16), 0)))
    out.append(hull_child(hull_obj, hull_obj.name + "_fin_bot", (2.6 * fin_scale, 0.16, 1.25 * fin_scale),
                          (-L * 0.36, 0, -hull_obj.dimensions.z * 0.42), mats['gunmetal'],
                          rot=(0, math.radians(16), 0)))
    out.append(hull_child(hull_obj, hull_obj.name + "_stripe_a", (L * 0.55, 0.1, 0.3),
                          (L * 0.02, hull_obj.dimensions.y * 0.44, hull_obj.dimensions.z * 0.14),
                          mats['basalt_light']))
    out.append(hull_child(hull_obj, hull_obj.name + "_stripe_b", (L * 0.55, 0.1, 0.3),
                          (L * 0.02, -hull_obj.dimensions.y * 0.44, hull_obj.dimensions.z * 0.14),
                          mats['basalt_light']))
    return out

hero_hull = bpy.data.objects["hero_hull"]
detail_hull(hero_hull)
hull_cyl(hero_hull, "hero_engine_housing", 1.02, 1.1, (-6.1, 0, 0), mats['gunmetal_dark'],
         rot=(0, math.radians(90), 0), verts=16)
bpy.context.view_layer.update()
bay_hull = bpy.data.objects["bay_ship_hull"]
detail_hull(bay_hull)
cyl("bay_engine_housing", 1.02, 1.1, (-6.15, 0, 8.5), mat=mats['gunmetal_dark'], anchor="interior-bay-ship",
    rot=(0, math.radians(90), 0), verts=16)

for i in range(1, 7):
    h = bpy.data.objects.get(f"traffic-{i:02d}_hull")
    if h:
        detail_hull(h, fin_scale=0.8)
for i in range(1, 4):
    h = bpy.data.objects.get(f"docked-{i:02d}_hull")
    if h:
        detail_hull(h, fin_scale=0.8)
        c = Vector(h.location)
        inw = -c.normalized()
        a = c + Vector((inw.x * 1.5, inw.y * 1.5, 0)) + Vector((0, 0, 0.4))
        b = c + Vector((inw.x * 7.5, inw.y * 7.5, 0)) + Vector((0, 0, 0.4))
        beam(f"docked-{i:02d}_arm", tuple(a), tuple(b), 0.55, mats['gunmetal'], f"docked-{i:02d}")
hauler_hull = bpy.data.objects.get("hauler_hull") or next(
    (o for o in holder_meshes("witness-hauler") if 'hull' in o.name), None)
if hauler_hull:
    detail_hull(hauler_hull, fin_scale=0.9)
    hull_child(hauler_hull, "hauler_pod_a", (4.6, 2.2, 2.4), (-0.5, 2.9, -0.2), mats['basalt_light'])
    hull_child(hauler_hull, "hauler_pod_b", (4.6, 2.2, 2.4), (-0.5, -2.9, -0.2), mats['basalt_light'])
ctrl = bpy.data.objects.get("controller_hull") or next(
    (o for o in holder_meshes("harbor-controller-ship") if o.name != "controller_nav_marker"), None)
if ctrl:
    detail_hull(ctrl, fin_scale=0.7)
    hull_child(ctrl, "controller_mast", (0.14, 0.14, 1.9), (0.6, 0, ctrl.dimensions.z * 0.6), mats['gunmetal'])
shuttle = next((o for o in holder_meshes("docking-shuttle") if o.type == 'MESH'), None)
if shuttle:
    detail_hull(shuttle, fin_scale=0.7)
user_ship = next((o for o in holder_meshes("interior-user-ship") if 'hull' in o.name), None)
if user_ship:
    detail_hull(user_ship, fin_scale=0.8)

# dressing-annex extras
DA = "dressing-annex"
tube("dressannex_pipe", (-196.0, 84.0, 1.0), (-160.0, 84.0, 1.0), 0.32, mats['gunmetal_dark'], DA, verts=8)
box("dressannex_crate", (2.6, 2.0, 1.9), (-176.0, 88.0, 0.95), mat=mats['basalt_light'], anchor=DA, bevel=0.08)
cyl("dressannex_tank", 1.3, 3.0, (-196.0, 92.0, 1.5), mat=mats['gunmetal'], anchor=DA, verts=12)

save_master()
bpy.ops.wm.save_as_mainfile(filepath="/home/hatch/workspace/Soumaya-Environment-Production/source/pass2-backups/soumaya_worlds_master_p2-04b-annex-ships.blend")
raw, est = draw_estimate(ext)
report(f"annex+ship detail done; exterior raw={raw} sets={est}")
