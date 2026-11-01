"""Pass 2 step 4: interior detail — hangar pilasters/girts/overhead crane,
floor guide markings (geometry+paint, no letters), commission board framing
and light panels, fleet-deck railings + blank placards, observation mullions,
benches, cove light. All four rooms to the same standard."""
import bpy, sys, math, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
from mathutils import Vector, Matrix

intr = bpy.data.scenes["STATION_INTERIOR"]
set_scene(intr)
bpy.context.view_layer.update()
mats = build_p2_materials()
AMBER = bpy.data.materials["MAT_amber_emit"]
AMBER_SOFT = bpy.data.materials["MAT_amber_emit_soft"]
DARK = bpy.data.materials["MAT_dark_unlit"]

def beam(name, a, b, t, mat, anchor):
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2; d = b - a
    o = box(name, (d.length, t, t), tuple(mid), mat=mat, anchor=anchor)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(d.normalized())
    return o

# ================= HANGAR BAY (70 x 40, walls 20 high, ship centre) =================
HB = "hangar-bay"
for sgn in (1, -1):
    for y in (-14.0, -7.0, 0.0, 7.0, 14.0):
        box(f"hangar_pilaster_{sgn}_{int(y)}", (1.1, 1.5, 18.0), (sgn * 34.1, y, 9.0), mat=mats['gunmetal_dark'], anchor=HB)
    for z in (6.0, 13.0):
        box(f"hangar_girt_{sgn}_{int(z)}", (0.55, 39.0, 0.85), (sgn * 34.55, 0.0, z), mat=mats['gunmetal'], anchor=HB)
for x in (-24.0, -12.0, 0.0, 12.0, 24.0):
    box(f"hangar_pilaster_b_{int(x)}", (1.5, 1.1, 18.0), (x, 19.1, 9.0), mat=mats['gunmetal_dark'], anchor=HB)
for z in (6.0, 13.0):
    box(f"hangar_girt_b_{int(z)}", (69.0, 0.55, 0.85), (0.0, 19.55, z), mat=mats['gunmetal'], anchor=HB)
# overhead crane: rails, bridge, hoist
for sgn in (1, -1):
    box(f"hangar_crane_rail_{sgn}", (1.1, 38.0, 0.9), (sgn * 8.0, 0.0, 18.6), mat=mats['gunmetal'], anchor=HB)
box("hangar_crane_bridge", (17.6, 1.7, 1.4), (0.0, -4.0, 17.6), mat=mats['gunmetal'], anchor=HB)
box("hangar_crane_hoist", (2.3, 2.3, 2.4), (0.0, -4.0, 16.0), mat=mats['gunmetal_dark'], anchor=HB)
cyl("hangar_crane_cable", 0.09, 5.0, (0.0, -4.0, 12.3), mat=DARK, anchor=HB, verts=6)
box("hangar_crane_hook", (1.0, 1.0, 1.2), (0.0, -4.0, 9.5), mat=mats['basalt_light'], anchor=HB)
box("hangar_crane_lamp", (0.7, 0.7, 0.35), (0.0, -4.0, 18.5), mat=AMBER, anchor=HB)

# floor guide markings (in the floor holder so they bake with the floor)
FH = "interior-floor-hangar-bay"
for i in range(8):
    box(f"hangar_cl_dash_{i}", (0.55, 2.6, 0.07), (0.0, -17.5 + i * 5.0, 0.05), mat=mats['marking'], anchor=FH)
box("hangar_berth_a", (18.0, 0.6, 0.07), (0.0, 5.2, 0.05), mat=AMBER_SOFT, anchor=FH)
box("hangar_berth_b", (18.0, 0.6, 0.07), (0.0, -5.2, 0.05), mat=AMBER_SOFT, anchor=FH)
box("hangar_berth_c", (0.6, 10.4, 0.07), (9.0, 0.0, 0.05), mat=AMBER_SOFT, anchor=FH)
box("hangar_berth_d", (0.6, 10.4, 0.07), (-9.0, 0.0, 0.05), mat=AMBER_SOFT, anchor=FH)
for i, x in enumerate((-12.0, -6.0, 0.0, 6.0, 12.0)):
    box(f"hangar_chev_{i}a", (2.3, 0.55, 0.07), (x - 0.75, -16.5, 0.05), mat=mats['marking'], anchor=FH,
        rot=(0, 0, math.radians(38)))
    box(f"hangar_chev_{i}b", (2.3, 0.55, 0.07), (x + 0.75, -16.5, 0.05), mat=mats['marking'], anchor=FH,
        rot=(0, 0, math.radians(-38)))
# hangar ceiling panels
CH = "interior-ceiling-hangar-bay"
for i, (x, y) in enumerate(((-17.0, -9.0), (17.0, -9.0), (-17.0, 9.0), (17.0, 9.0))):
    box(f"hangar_ceiling_panel_{i}", (12.0, 7.0, 0.35), (x, y, 19.75), mat=mats['gunmetal_dark'], anchor=CH)

# ================= COMMISSION BOARD =================
CB = "commission-board"
box("board_frame_top", (33.0, 0.55, 0.55), (110.0, 12.35, 10.4), mat=mats['gunmetal'], anchor=CB)
box("board_frame_bot", (33.0, 0.55, 0.55), (110.0, 12.35, 2.4), mat=mats['gunmetal'], anchor=CB)
box("board_frame_l", (0.55, 0.55, 8.5), (93.7, 12.35, 6.4), mat=mats['gunmetal'], anchor=CB)
box("board_frame_r", (0.55, 0.55, 8.5), (126.3, 12.35, 6.4), mat=mats['gunmetal'], anchor=CB)
for i, x in enumerate((100.0, 110.0, 120.0)):
    box(f"commission_lightpanel_{i}", (8.0, 3.2, 0.3), (x, 0.0, 11.65), mat=AMBER_SOFT, anchor=CB)
    box(f"commission_desklamp_{i}", (0.55, 0.55, 0.35), (x - 2.6, 3.2, 2.25), mat=AMBER, anchor=CB)
    box(f"commission_deskmodesty_{i}", (6.6, 0.3, 1.05), (x, 2.75, 0.95), mat=mats['gunmetal_dark'], anchor=CB)
box("commission_cabletrunk", (34.0, 1.1, 0.45), (110.0, 6.6, 0.22), mat=mats['gunmetal_dark'], anchor=CB)
for sgn, x in ((0, 88.45), (1, 131.55)):
    for j, y in enumerate((-6.0, 4.0)):
        box(f"commission_wallpanel_{sgn}_{j}", (0.35, 7.0, 5.0), (x, y, 6.0), mat=mats['gunmetal_dark'], anchor=CB)
FC = "interior-floor-commission-board"
box("commission_floor_trim_a", (40.0, 0.5, 0.07), (110.0, -11.6, 0.05), mat=mats['marking'], anchor=FC)
box("commission_floor_trim_b", (40.0, 0.5, 0.07), (110.0, 11.6, 0.05), mat=mats['marking'], anchor=FC)

# ================= FLEET DECK =================
FD = "fleet-deck"
for i in (1, 2):
    holder = f"interior-model-fleet-{i}"
    h = bpy.data.objects[holder]
    bb = bounds_of(h)
    if bb:
        lo, hi = bb
        cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
        rx, ry = (hi.x - lo.x) / 2 + 2.2, (hi.y - lo.y) / 2 + 2.2
        top = 1.15
        corners = [(cx - rx, cy - ry), (cx + rx, cy - ry), (cx + rx, cy + ry), (cx - rx, cy + ry)]
        for j, (px, py) in enumerate(corners):
            cyl(f"fleet{i}_railpost_{j}", 0.09, top, (px, py, top / 2), mat=mats['gunmetal'], anchor=FD, verts=8)
        for j in range(4):
            a = corners[j]; b = corners[(j + 1) % 4]
            beam(f"fleet{i}_rail_top_{j}", (a[0], a[1], top), (b[0], b[1], top), 0.12, mats['gunmetal'], FD)
            beam(f"fleet{i}_rail_mid_{j}", (a[0], a[1], top * 0.55), (b[0], b[1], top * 0.55), 0.09, mats['gunmetal'], FD)
        box(f"fleet{i}_placard_post", (0.16, 0.16, 1.0), (cx, cy - ry - 1.2, 0.5), mat=mats['gunmetal_dark'], anchor=FD)
        box(f"fleet{i}_placard_BLANK", (1.7, 0.14, 1.15), (cx, cy - ry - 1.35, 1.15), mat=mats['basalt_light'],
            anchor=FD, rot=(math.radians(-28), 0, 0))
        cyl(f"fleet{i}_spot_a", 0.7, 0.25, (cx - 3.0, cy, 12.7), mat=AMBER_SOFT, anchor=FD, verts=12)
        cyl(f"fleet{i}_spot_b", 0.7, 0.25, (cx + 3.0, cy, 12.7), mat=AMBER_SOFT, anchor=FD, verts=12)
for i, o in enumerate([x for x in holder_meshes(FD) if x.name.startswith("fleet_crate")]):
    box(f"fleet_crate_strap_{i}", (o.dimensions.x + 0.15, 0.5, o.dimensions.z + 0.12),
        tuple(o.location), mat=mats['gunmetal_dark'], anchor=FD)
for j, y in enumerate((-6.0, 4.0)):
    box(f"fleet_wallpanel_{j}", (7.0, 0.35, 5.0), (188.0 + j * 16.0, 14.45, 6.5), mat=mats['gunmetal_dark'], anchor=FD)
FF = "interior-floor-fleet-deck"
box("fleet_floor_trim_a", (46.0, 0.5, 0.07), (200.0, -13.6, 0.05), mat=mats['marking'], anchor=FF)
box("fleet_floor_trim_b", (46.0, 0.5, 0.07), (200.0, 13.6, 0.05), mat=mats['marking'], anchor=FF)

# fleet display hulls: fins + stripes in local space
def detail_small_hull(hull_obj):
    L = hull_obj.dimensions.x
    def child(name, dims, loc, mat, rot=(0, 0, 0)):
        o = box(name, dims, (0, 0, 0), mat=mat, anchor=None)
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
    child(hull_obj.name + "_fin", (L * 0.22, 0.12, L * 0.1), (-L * 0.36, 0, hull_obj.dimensions.z * 0.42),
          mats['gunmetal'], rot=(0, math.radians(-16), 0))
    child(hull_obj.name + "_stripe", (L * 0.55, 0.08, 0.24), (0, hull_obj.dimensions.y * 0.44, hull_obj.dimensions.z * 0.14),
          mats['basalt_light'])
for i in (1, 2):
    hs = [o for o in holder_meshes(f"interior-model-fleet-{i}") if o.type == 'MESH']
    if hs:
        biggest = max(hs, key=lambda o: o.dimensions.x * o.dimensions.y)
        detail_small_hull(biggest)
        report(f"fleet model {i}: detailed {biggest.name}")

# ================= OBSERVATION DECK =================
OD = "observation-deck"
VL = "interior-deck-viewport-lintel"
for x in (288.5, 311.5):
    box(f"viewport_mullion_x{int(x)}", (0.7, 0.9, 9.2), (x, -12.2, 6.0), mat=mats['gunmetal_dark'], anchor=VL)
box("viewport_midrail", (36.0, 0.9, 0.7), (300.0, -12.2, 6.0), mat=mats['gunmetal_dark'], anchor=VL)
box("obs_cove_light", (30.0, 0.4, 0.4), (300.0, -11.3, 11.35), mat=AMBER_SOFT, anchor=OD)
for i, x in enumerate((293.0, 307.0)):
    box(f"obs_bench_{i}", (7.0, 1.8, 0.5), (x, -2.0, 1.05), mat=mats['wood'], anchor=OD, bevel=0.08)
    box(f"obs_bench_leg_{i}a", (6.2, 1.2, 0.8), (x, -2.0, 0.4), mat=mats['gunmetal_dark'], anchor=OD)
for i, x in enumerate((289.0, 311.0)):
    cyl(f"obs_table_{i}", 0.95, 1.0, (x, -6.0, 0.5), mat=mats['gunmetal_dark'], anchor=OD, verts=14)
for i, x in enumerate((291.5, 308.5)):
    box(f"obs_console_ext_{i}", (3.0, 2.0, 1.1), (x, -8.0, 1.05), mat=mats['gunmetal_dark'], anchor=OD)
    box(f"obs_console_ext_glow_{i}", (2.6, 0.25, 0.8), (x, -8.7, 1.85), mat=AMBER_SOFT, anchor=OD)
FO = "interior-floor-observation-deck"
box("obs_floor_trim_a", (36.0, 0.5, 0.07), (300.0, -10.6, 0.05), mat=mats['marking'], anchor=FO)
box("obs_floor_trim_b", (36.0, 0.5, 0.07), (300.0, 10.6, 0.05), mat=mats['marking'], anchor=FO)

save_master()
bpy.ops.wm.save_as_mainfile(filepath="/home/hatch/workspace/Soumaya-Environment-Production/source/pass2-backups/soumaya_worlds_master_p2-05-interior.blend")
raw, est = draw_estimate(intr)
report(f"interior detail done; interior raw={raw} sets={est}")
