"""Pass 2 step 2: wheel detail — new rim segment (panelled, ribbed, windowed,
docking port, radiators, greebles) instanced x48; beacon fixtures replace the
bare spheres; hub extras (radiator fins, antenna, docking rings, fairings);
4 maintenance gantries on the inner rim. Second seam untouched (sealed)."""
import bpy, sys, math, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
from mathutils import Matrix

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
mats = build_p2_materials()
AMBER = bpy.data.materials["MAT_amber_emit"]
AMBER_SOFT = bpy.data.materials["MAT_amber_emit_soft"]
CYAN = bpy.data.materials["MAT_cyan_emit"]
DARK = bpy.data.materials["MAT_dark_unlit"]
HOLDER = "station-rotating"
OX = 210.0  # segment_00 centre x

parts = []
def P(name, dims, loc, mat, bevel=0.0):
    o = box("rimseg_" + name, dims, (OX + loc[0], loc[1], loc[2]), mat=mat, anchor=HOLDER, bevel=bevel)
    parts.append(o)
    return o
def PC(name, r, depth, loc, mat, rot=(0, 0, 0), verts=20):
    o = cyl("rimseg_" + name, r, depth, (OX + loc[0], loc[1], loc[2]), mat=mat, anchor=HOLDER, rot=rot, verts=verts)
    parts.append(o)
    return o

# --- segment body ---
P("main_plate", (25.5, 25.0, 19.0), (0, 0, -0.5), mats['basalt'], bevel=0.5)
P("outer_skin", (1.8, 24.0, 20.5), (13.3, 0, 0), mats['gunmetal'])
P("inner_skin", (1.4, 24.0, 20.0), (-13.4, 0, 0), mats['basalt'])
P("deck_plate", (24.0, 24.0, 1.2), (0, 0, 10.6), mats['gunmetal_dark'])
P("keel_plate", (22.0, 20.0, 1.6), (0, 0, -10.9), mats['gunmetal_dark'])
# outer ribs
for i, y in enumerate((-8.0, 0.0, 8.0)):
    P(f"rib_{i}", (1.4, 1.6, 17.0), (14.2, y, 0), mats['gunmetal'])
# window rows on the outer face (3 of 16 dark = unlit cabins)
win_idx = 0
for z in (5.0, -2.0):
    for y in (-10.9, -9.7, -4.6, -3.4, 3.4, 4.6, 9.7, 10.9):
        m = DARK if win_idx in (3, 9, 13) else AMBER_SOFT
        P(f"win_{win_idx}", (0.3, 1.1, 0.75), (14.35, y, z), m)
        win_idx += 1
# panel seam strips on outer skin
P("seamstrip_a", (0.18, 24.0, 0.5), (14.28, 0, 7.6), mats['gunmetal_dark'])
P("seamstrip_b", (0.18, 24.0, 0.5), (14.28, 0, -6.4), mats['gunmetal_dark'])
# docking port on inner face
P("port_frame", (0.8, 9.0, 11.0), (-14.1, 0, 0), mats['gunmetal_dark'])
P("port_recess", (0.5, 7.0, 9.0), (-14.4, 0, 0), DARK)
PC("port_ring", 2.6, 0.6, (-14.6, 0, 0), mats['gunmetal'], rot=(0, math.radians(90), 0), verts=24)
P("port_light_a", (0.3, 0.6, 3.0), (-14.25, 5.6, 0), AMBER_SOFT)
P("port_light_b", (0.3, 0.6, 3.0), (-14.25, -5.6, 0), AMBER_SOFT)
# radiator panels + fins on both tangential faces
for sgn in (1, -1):
    P(f"rad_{sgn}", (10.0, 0.5, 13.0), (0, sgn * 13.05, 0), mats['gunmetal_dark'])
    for j, z in enumerate((-4.0, 0.0, 4.0)):
        P(f"radfin_{sgn}_{j}", (10.0, 0.3, 1.2), (0, sgn * 13.35, z), mats['gunmetal'])
# top-deck greebles (low profile)
P("hatch", (4.0, 4.0, 0.5), (5, 5, 11.45), mats['gunmetal_dark'])
P("conduit", (16.0, 1.0, 0.5), (0, -10.5, 11.45), mats['gunmetal_dark'])
for i, y in enumerate((-6.0, 6.0)):
    o = sphere(f"rimseg_blister_{i}", 0.85, (OX - 5.0, y, 11.15), mat=mats['gunmetal'], anchor=HOLDER, seg=12, rings=8)
    o.scale = (1.0, 1.0, 0.55)
    parts.append(o)
PC("tank", 1.05, 2.6, (-8.5, -4.0, 10.6), mats['gunmetal'], verts=16)
# keel pipes
for i, x in enumerate((-4.0, 4.0)):
    PC(f"keelpipe_{i}", 0.35, 19.0, (x, 0, -11.85), mats['gunmetal'], rot=(math.radians(90), 0, 0), verts=10)

authored = merge_objects(parts, "rimseg_authored", HOLDER)
authored.data.transform(Matrix.Translation((-OX, 0, 0)))
authored.location = (OX, 0, 0)
authored.data.name = "rim_segment_mesh_v2"
segs = [o for o in bpy.data.objects if o.name.startswith("rim_segment_")]
for o in segs:
    o.data = authored.data
old_mesh = bpy.data.meshes.get("Cube.012")
bpy.data.objects.remove(authored, do_unlink=True)
if old_mesh and old_mesh.users == 0:
    bpy.data.meshes.remove(old_mesh)
seg_tris = sum(len(p.vertices) - 2 for p in segs[0].data.polygons)
report(f"rim segment v2: {seg_tris} tris, instanced on {len(segs)} segments")

# --- beacon fixtures: housings (bake later) + merged domes ---
beacons = sorted([o for o in bpy.data.objects if o.name.startswith("beacon_") and o.type == 'MESH'],
                 key=lambda o: o.name)
bpos = [(o.name, tuple(o.location), o.material_slots[0].material.name if o.material_slots else '') for o in beacons]
housings = []
for name, loc, matname in bpos:
    bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    base = cyl(f"{name}_housing", 0.78, 0.3, (loc[0], loc[1], 11.85), mat=mats['gunmetal_dark'], anchor=HOLDER, verts=12)
    post = cyl(f"{name}_post", 0.42, 0.85, (loc[0], loc[1], 12.35), mat=mats['gunmetal'], anchor=HOLDER, verts=10)
    housings += [base, post]
amber_domes, cyan_domes = [], []
for name, loc, matname in bpos:
    is_cyan = (matname == 'MAT_cyan_emit')
    r = 0.72 if is_cyan else 0.62
    d = sphere(f"{name}_dome", r, (loc[0], loc[1], 12.95), mat=(CYAN if is_cyan else AMBER),
               anchor=HOLDER, seg=10, rings=6)
    (cyan_domes if is_cyan else amber_domes).append(d)
report(f"beacons rebuilt: {len(bpos)} fixtures ({len(cyan_domes)} cyan, {len(amber_domes)} amber)")

# --- hub extras + spoke fairings + maintenance gantries (all -> wheel bake set) ---
extras = []
for k in range(8):
    a = math.radians(k * 45)
    o = box(f"hub_radfin_{k}", (7.0, 0.45, 13.0), (30 * math.cos(a), 30 * math.sin(a), 2.0),
            mat=mats['gunmetal_dark'], anchor=HOLDER, rot=(0, 0, a))
    extras.append(o)
for k in range(6):
    a = math.radians(k * 60)
    o = box(f"spoke_fairing_{k}", (11.0, 10.0, 11.5), (33 * math.cos(a), 33 * math.sin(a), 0),
            mat=mats['gunmetal'], anchor=HOLDER, rot=(0, 0, a))
    extras.append(o)
mast = cyl("hub_antenna_mast", 0.32, 6.5, (6.0, 0, 22.0), mat=mats['gunmetal'], anchor=HOLDER, verts=10)
dish = sphere("hub_antenna_dish", 2.3, (6.0, 0, 25.6), mat=mats['basalt_light'], anchor=HOLDER, seg=16, rings=10)
dish.scale = (1.0, 1.0, 0.38)
dish.rotation_euler = (math.radians(35), 0, 0)
extras += [mast, dish]
ring1 = None
bpy.ops.mesh.primitive_torus_add(major_radius=5.2, minor_radius=0.55, major_segments=28, minor_segments=8,
                                 location=(0, 0, 19.3))
ring1 = bpy.context.active_object; ring1.name = "hub_dock_ring"
assign(ring1, mats['gunmetal']); put(ring1, HOLDER); extras.append(ring1)
disc = cyl("hub_dock_disc", 4.5, 0.4, (0, 0, 19.05), mat=DARK, anchor=HOLDER, verts=24)
extras.append(disc)
for gi, ang in enumerate((30, 150, 210, 330)):
    a = math.radians(ang)
    cx, cy = 186 * math.cos(a), 186 * math.sin(a)
    plat = box(f"gantry_r{gi}", (13.0, 8.0, 0.6), (cx, cy, -6.0), mat=mats['gunmetal'], anchor=HOLDER, rot=(0, 0, a))
    s1 = box(f"gantry_s{gi}a", (10.0, 0.5, 0.5), (cx + 8 * math.cos(a), cy + 8 * math.sin(a), -8.6),
             mat=mats['gunmetal_dark'], anchor=HOLDER, rot=(0, math.radians(28), a))
    rail = box(f"gantry_rail{gi}", (13.0, 0.35, 0.35), (cx - 5.5 * math.cos(a), cy - 5.5 * math.sin(a), -4.4),
               mat=mats['gunmetal'], anchor=HOLDER, rot=(0, 0, a))
    lamp = box(f"gantry_lamp{gi}", (1.4, 0.5, 0.4), (cx, cy, -5.2), mat=AMBER_SOFT, anchor=HOLDER, rot=(0, 0, a))
    extras += [plat, s1, rail]
report(f"hub extras + gantries added: {len(extras)} objects")

save_master()
bpy.ops.wm.save_as_mainfile(filepath="/home/hatch/workspace/Soumaya-Environment-Production/source/pass2-backups/soumaya_worlds_master_p2-03-wheel.blend")
bpy.ops.wm.open_mainfile(filepath=MASTER)
raw, est = draw_estimate(bpy.data.scenes["STATION_EXTERIOR"])
report(f"exterior draw estimate now: raw={raw} sets={est}")
