"""Pass 2 step 3a: drydock complex detail — gantry rails/braces/trolley,
berth-board structure (header plate stays BLANK), scaffold arms, umbilical
tower, work-light rigs, pad markings, dressing props."""
import bpy, sys, math, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
from mathutils import Vector

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
mats = build_p2_materials()
AMBER = bpy.data.materials["MAT_amber_emit"]
AMBER_SOFT = bpy.data.materials["MAT_amber_emit_soft"]
DARK = bpy.data.materials["MAT_dark_unlit"]
G = "witness-drydock-gantry"

def beam(name, a, b, t, mat, anchor):
    a, b = Vector(a), Vector(b)
    mid = (a + b) / 2; d = b - a
    o = box(name, (d.length, t, t), tuple(mid), mat=mat, anchor=anchor)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(d.normalized())
    return o

# ---------------- gantry: rails, braces, trolley, second hook ----------------
for x in (82.0, 94.0):
    box(f"gantry_rail_{int(x)}", (1.5, 42.0, 0.7), (x, -195.0, 0.35), mat=mats['gunmetal_dark'], anchor=G)
    box(f"gantry_railstop_{int(x)}a", (2.2, 1.0, 1.6), (x, -215.0, 0.8), mat=mats['gunmetal'], anchor=G)
    box(f"gantry_railstop_{int(x)}b", (2.2, 1.0, 1.6), (x, -175.0, 0.8), mat=mats['gunmetal'], anchor=G)
beam("gantry_brace_a", (82.7, -193.4, 3.0), (93.3, -193.4, 31.0), 0.55, mats['gunmetal'], G)
beam("gantry_brace_b", (93.3, -193.4, 3.0), (82.7, -193.4, 31.0), 0.55, mats['gunmetal'], G)
beam("gantry_brace_c", (82.7, -196.6, 3.0), (93.3, -196.6, 31.0), 0.55, mats['gunmetal'], G)
beam("gantry_brace_d", (93.3, -196.6, 3.0), (82.7, -196.6, 31.0), 0.55, mats['gunmetal'], G)
box("gantry_trolley", (4.6, 4.4, 1.3), (88.0, -195.0, 33.1), mat=mats['gunmetal_dark'], anchor=G)
cyl("gantry_cable2", 0.16, 7.0, (84.5, -195.0, 26.0), mat=DARK, anchor=G, verts=8)
box("gantry_hook2", (1.3, 1.3, 1.7), (84.5, -195.0, 21.8), mat=mats['basalt_light'], anchor=G)
cyl("gantry_cabin_antenna", 0.09, 2.6, (94.0, -195.0, 33.0), mat=mats['gunmetal'], anchor=G, verts=6)
box("gantry_cabin_lamp", (0.5, 0.5, 0.4), (94.0, -192.9, 30.4), mat=AMBER_SOFT, anchor=G)

# ---------------- berth board: structure; header plate BLANK ----------------
box("berthboard_header_BLANK", (11.6, 0.85, 1.5), (99.0, -186.0, 13.4), mat=mats['basalt_light'], anchor=G)
for x in (93.1, 104.9):
    box(f"berthboard_frame_{int(x)}", (0.55, 0.85, 6.6), (x, -186.0, 9.5), mat=mats['gunmetal'], anchor=G)
box("berthboard_shelf", (12.2, 1.6, 0.5), (99.0, -186.0, 5.9), mat=mats['gunmetal_dark'], anchor=G)
beam("berthboard_strut_a", (99.0, -186.0, 3.0), (99.0, -184.2, 9.0), 0.4, mats['gunmetal_dark'], G)
box("berthboard_lamp", (0.6, 0.6, 0.4), (99.0, -186.8, 14.4), mat=AMBER, anchor=G)

# ---------------- work-light rigs flanking the pads ----------------
for i, (x, y) in enumerate(((66.0, -186.0), (120.0, -186.0))):
    cyl(f"rig{i}_mast", 0.35, 13.0, (x, y, 6.5), mat=mats['gunmetal_dark'], anchor=G, verts=10)
    box(f"rig{i}_base", (2.4, 2.4, 0.8), (x, y, 0.4), mat=mats['basalt'], anchor=G)
    bar = box(f"rig{i}_bar", (4.6, 0.45, 0.45), (x, y, 13.1), mat=mats['gunmetal'], anchor=G)
    for j, dx in enumerate((-1.9, 0.0, 1.9)):
        box(f"rig{i}_head{j}", (0.95, 0.95, 0.55), (x + dx, y - 0.3, 12.8), mat=AMBER, anchor=G,
            rot=(math.radians(-18), 0, 0))

# ---------------- drydock-main: scaffolds, umbilical tower, markings ----------------
DM = "drydock-main"
for i, (x, y) in enumerate(((36.0, -176.0), (68.0, -160.0))):
    box(f"scaffold{i}_post", (0.85, 0.85, 12.5), (x, y, 9.2), mat=mats['gunmetal'], anchor=DM)
    box(f"scaffold{i}_arm", (6.5, 0.65, 0.65), (x + (3.0 if i == 0 else -3.0), y, 14.6), mat=mats['gunmetal'], anchor=DM)
    box(f"scaffold{i}_deck", (5.5, 3.2, 0.4), (x + (2.6 if i == 0 else -2.6), y, 15.1), mat=mats['gunmetal_dark'], anchor=DM)
    box(f"scaffold{i}_lamp", (0.6, 0.6, 0.4), (x, y, 15.6), mat=AMBER_SOFT, anchor=DM)
box("umbilical_tower", (3.2, 3.2, 15.0), (30.0, -150.0, 7.5), mat=mats['gunmetal'], anchor=DM, bevel=0.2)
beam("umbilical_arm_a", (30.0, -150.0, 12.0), (38.0, -156.0, 12.6), 0.7, mats['gunmetal_dark'], DM)
beam("umbilical_arm_b", (30.0, -150.0, 8.5), (37.0, -144.5, 9.0), 0.7, mats['gunmetal_dark'], DM)
box("umbilical_head", (1.4, 1.4, 1.8), (38.2, -156.2, 12.4), mat=mats['basalt_light'], anchor=DM)
box("umbilical_lamp", (0.6, 0.6, 0.4), (30.0, -148.2, 15.3), mat=AMBER, anchor=DM)
for i, (dims, loc) in enumerate((((40.0, 0.7, 0.12), (52.0, -155.2, 3.1)), ((40.0, 0.7, 0.12), (52.0, -180.8, 3.1)),
                                 ((0.7, 24.0, 0.12), (31.2, -168.0, 3.1)), ((0.7, 24.0, 0.12), (72.8, -168.0, 3.1)))):
    box(f"main_pad_mark_{i}", dims, loc, mat=mats['marking'], anchor=DM)
cyl("main_pipe_run", 0.4, 38.0, (52.0, -181.5, 3.9), mat=mats['gunmetal'], anchor=DM, rot=(0, math.radians(90), 0), verts=12)
for i, x in enumerate((38.0, 52.0, 66.0)):
    box(f"main_pipe_foot_{i}", (1.2, 1.2, 1.0), (x, -181.5, 3.2), mat=mats['gunmetal_dark'], anchor=DM)

# ---------------- drydock-witness: scaffold + markings ----------------
DW = "drydock-witness"
box("witness_scaffold_post", (0.8, 0.8, 10.5), (90.5, -184.0, 8.2), mat=mats['gunmetal'], anchor=DW)
box("witness_scaffold_arm", (5.5, 0.6, 0.6), (93.2, -184.0, 12.8), mat=mats['gunmetal'], anchor=DW)
box("witness_scaffold_deck", (4.6, 2.8, 0.35), (93.0, -184.0, 13.2), mat=mats['gunmetal_dark'], anchor=DW)
for i, (dims, loc) in enumerate((((26.0, 0.6, 0.12), (105.0, -166.8, 3.1)), ((26.0, 0.6, 0.12), (105.0, -187.2, 3.1)))):
    box(f"witness_pad_mark_{i}", dims, loc, mat=mats['marking'], anchor=DW)

# ---------------- dressing-drydock: crates, drums, hose reel ----------------
DD = "dressing-drydock"
for i, (dims, loc) in enumerate((((3.2, 2.4, 2.2), (24.0, -190.0, 1.1)), ((3.2, 2.4, 2.2), (24.0, -190.0, 3.3)),
                                 ((2.6, 2.0, 1.8), (28.5, -188.0, 0.9)))):
    box(f"dress_crate_{i}", dims, loc, mat=mats['basalt_light'] if i < 2 else mats['gunmetal'], anchor=DD, bevel=0.08)
for i, (x, y) in enumerate(((74.0, -146.0), (76.3, -146.4), (75.1, -144.2))):
    cyl(f"dress_drum_{i}", 0.95, 2.3, (x, y, 1.15), mat=mats['gunmetal'] if i else mats['basalt_light'], anchor=DD, verts=14)
bpy.ops.mesh.primitive_torus_add(major_radius=1.5, minor_radius=0.32, major_segments=20, minor_segments=8,
                                 location=(34.0, -146.0, 1.9))
reel = bpy.context.view_layer.objects.active
reel.name = "dress_hosereel"
assign(reel, mats['gunmetal_dark']); put(reel, DD)
box("dress_reel_frame", (0.5, 3.4, 2.6), (34.0, -146.0, 1.3), mat=mats['gunmetal'], anchor=DD)

save_master()
bpy.ops.wm.save_as_mainfile(filepath="/home/hatch/workspace/Soumaya-Environment-Production/source/pass2-backups/soumaya_worlds_master_p2-04a-drydock.blend")
report("drydock detail done")
