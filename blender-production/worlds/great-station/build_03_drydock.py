"""Stage C step 3: drydock complex, gantry, berth-board (11 lit / 1 dark, blank),
dressing, station work lights. Gantry three [88,20,195] -> Blender (88,-195,~)."""
import bpy, sys, math
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

bpy.context.window.scene = bpy.data.scenes["STATION_EXTERIOR"]
M = {k: bpy.data.materials["MAT_" + k] for k in
     ["basalt", "basalt_light", "gunmetal", "gunmetal_dark", "amber_emit", "amber_emit_soft",
      "cyan_emit", "dark_unlit", "wood_warm"]}

for n in ("BLOCK_gantry", "BLOCK_drydock_witness", "BLOCK_drydock_main"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)

G = "witness-drydock-gantry"
# ---- gantry: two legs, top beam, hoist, cabin — compact distinct silhouette ----
box("gantry_leg_a", (2.6, 3.2, 34), (82, -195, 17), mat=M['gunmetal'], anchor=G, bevel=0.15)
box("gantry_leg_b", (2.6, 3.2, 34), (94, -195, 17), mat=M['gunmetal'], anchor=G, bevel=0.15)
box("gantry_beam", (17, 4, 3.2), (88, -195, 35.5), mat=M['gunmetal'], anchor=G, bevel=0.15)
box("gantry_hoist", (3.4, 3.4, 4.5), (88, -195, 31), mat=M['gunmetal_dark'], anchor=G)
box("gantry_cable", (0.35, 0.35, 9), (88, -195, 24.5), mat=M['dark_unlit'], anchor=G)
box("gantry_hook", (1.6, 1.6, 1.2), (88, -195, 19.5), mat=M['basalt_light'], anchor=G)
box("gantry_cabin", (4.5, 3.6, 3.4), (94, -195, 30), mat=M['basalt'], anchor=G)
box("gantry_cabin_glass", (0.3, 2.6, 1.4), (91.7, -195, 30.4), mat=M['amber_emit_soft'], anchor=G)
for lx in (82, 94):
    box(f"gantry_worklight_{lx}", (1.1, 1.1, 0.7), (lx, -195, 37.4), mat=M['amber_emit'], anchor=G)
box("gantry_base_a", (5, 6, 2), (82, -195, 1), mat=M['basalt'], anchor=G)
box("gantry_base_b", (5, 6, 2), (94, -195, 1), mat=M['basalt'], anchor=G)

# ---- berth-board beside the gantry: 12 slots, 11 lit, 1 dark, NO text ----
box("berthboard_post", (0.9, 0.9, 7.5), (99, -186, 3.75), mat=M['gunmetal_dark'], anchor=G)
board = box("berthboard_panel", (11, 0.7, 6), (99, -186, 9.5), mat=M['basalt'], anchor=G, rot=(0, 0, math.radians(-18)))
# slot plates on the board's -Y face (facing the drydock approach)
dark_slot = 7
for i in range(12):
    col, row = i % 6, i // 6
    lx = 99 + (col - 2.5) * 1.62 * math.cos(math.radians(-18))
    ly = -186.55 - (col - 2.5) * 1.62 * math.sin(math.radians(-18)) * -1
    lz = 11.1 - row * 2.6
    mat = M['dark_unlit'] if i == dark_slot else M['amber_emit_soft']
    s = box(f"berthboard_slot_{i:02d}", (1.25, 0.18, 1.9), (lx, -186.55, lz), mat=mat, anchor=G,
            rot=(0, 0, math.radians(-18)))
report(f"berth-board: 12 slots, slot {dark_slot} dark (the missing berth), 11 lit, faces blank")

# ---- drydock-witness: pad + cradle arms + keel blocks (the witness drydock) ----
W = "drydock-witness"
box("witness_pad", (30, 22, 3), (105, -177, 1.5), mat=M['basalt'], anchor=W, bevel=0.2)
for sx in (-1, 1):
    box(f"witness_cradle_{'a' if sx<0 else 'b'}", (2.2, 16, 7), (105 + sx * 9, -177, 6),
        mat=M['gunmetal'], anchor=W, rot=(0, math.radians(sx * -12), 0))
for i in range(4):
    box(f"witness_keel_{i}", (3.2, 2.4, 2.2), (105, -184 + i * 4.6, 4.1), mat=M['gunmetal_dark'], anchor=W)
box("witness_apron_light", (30, 0.8, 0.5), (105, -165.2, 3.2), mat=M['amber_emit_soft'], anchor=W)

# ---- drydock-main: bigger pad, rails, cradle pair ----
D = "drydock-main"
box("main_pad", (44, 26, 3), (52, -168, 1.5), mat=M['basalt'], anchor=D, bevel=0.2)
for sx in (-1, 1):
    box(f"main_cradle_{'a' if sx<0 else 'b'}", (2.6, 20, 9), (52 + sx * 13, -168, 7),
        mat=M['gunmetal'], anchor=D, rot=(0, math.radians(sx * -10), 0))
    box(f"main_rail_{'a' if sx<0 else 'b'}", (40, 1.1, 0.8), (52, -168 + sx * 11.5, 3.4), mat=M['gunmetal_dark'], anchor=D)
for i in range(5):
    box(f"main_keel_{i}", (3.6, 2.6, 2.6), (52, -176 + i * 4.2, 4.3), mat=M['gunmetal_dark'], anchor=D)

# ---- dressing-drydock: containers, pipes, drums, crates ----
DR = "dressing-drydock"
cols = [M['basalt_light'], M['gunmetal'], M['basalt']]
for i, (dx, dy, dz, ry) in enumerate([(30, -150, 3, 0.2), (38.5, -150, 3, 0.2), (34, -150, 8.6, 0.2), (70, -152, 3, -0.15)]):
    box(f"dressing_container_{i}", (8, 4.5, 5.6), (dx, dy, dz), mat=cols[i % 3], anchor=DR, rot=(0, 0, ry), bevel=0.12)
for i in range(3):
    cyl(f"dressing_pipe_{i}", 0.85, 20, (24, -158 + i * 1.9, 1 + i * 0.4), mat=M['gunmetal'], anchor=DR,
        rot=(0, math.radians(90), 0), verts=12)
for i, (dx, dy) in enumerate([(66, -184), (69, -184), (67.5, -181.5)]):
    cyl(f"dressing_drum_{i}", 1.3, 3.1, (dx, dy, 1.55), mat=M['basalt_light'] if i else M['gunmetal'], anchor=DR, verts=12)
box("dressing_crate_a", (3, 3, 3), (74, -160, 1.5), mat=M['wood_warm'], anchor=DR, rot=(0, 0, 0.4))
box("dressing_crate_b", (2.2, 2.2, 2.2), (74.5, -160, 4.1), mat=M['wood_warm'], anchor=DR, rot=(0, 0, 0.9))

# ---- station-work-lights: emissive poles around drydock + apron (no real lights) ----
WL = "station-work-lights"
for i, (px, py) in enumerate([(70, -150), (120, -160), (40, -190), (118, -196)]):
    cyl(f"worklight_pole_{i}", 0.28, 9, (px, py, 4.5), mat=M['gunmetal_dark'], anchor=WL, verts=8)
    box(f"worklight_head_{i}", (1.5, 1.5, 0.8), (px, py, 9.3), mat=M['amber_emit'], anchor=WL)

b = bounds_of(bpy.data.objects[G])
lo, hi = b
report(f"gantry holder bounds centre=({(lo[0]+hi[0])/2:.1f}, {(lo[1]+hi[1])/2:.1f}, {(lo[2]+hi[2])/2:.1f}) size=({hi[0]-lo[0]:.1f}, {hi[1]-lo[1]:.1f}, {hi[2]-lo[2]:.1f}) — compact, distinct from drydock pads")
save_master()
report("drydock build saved")
