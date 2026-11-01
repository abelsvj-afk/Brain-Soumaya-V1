"""Stage C step 6 (build order step 8): the interior — four room sets under
station-interior. Hangar: her ship floating at the EXACT centre. Observation:
viewport lintel framing wheel arc + planet. No corridors between rooms (jump
navigation — no connective space modelled)."""
import bpy, sys, math
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

intr = bpy.data.scenes["STATION_INTERIOR"]
bpy.context.window.scene = intr
M = {k: bpy.data.materials["MAT_" + k] for k in
     ["basalt", "basalt_light", "gunmetal", "gunmetal_dark", "amber_emit", "amber_emit_soft",
      "cyan_emit", "dark_unlit", "hull_pale", "glass", "interior_wall", "interior_floor", "wood_warm"]}

ROOMS = ["hangar-bay", "commission-board", "fleet-deck", "observation-deck"]
INTERIOR_ANCHORS = ROOMS + [
    "interior-bay-ship", "interior-user-ship", "interior-bay-door-lintel",
    "interior-deck-viewport-lintel", "interior-gate-lintel", "interior-gate-lights",
    "interior-rim-arc", "interior-nav-markers", "interior-work-lights", "interior-light-strips",
    "interior-model-fleet-1", "interior-model-fleet-2",
] + [f"interior-floor-{r}" for r in ROOMS] + [f"interior-ceiling-{r}" for r in ROOMS]

root_anchor(intr, "station-interior")
for name in INTERIOR_ANCHORS:
    make_anchor(intr, "station-interior", name, parent_name="station-interior")
report(f"interior anchors: {len(INTERIOR_ANCHORS)} + root")

CX = {"hangar-bay": 0, "commission-board": 110, "fleet-deck": 200, "observation-deck": 300}
SIZE = {"hangar-bay": (70, 40, 20), "commission-board": (44, 26, 12),
        "fleet-deck": (50, 30, 13), "observation-deck": (40, 24, 12)}

def room_shell(room):
    cx = CX[room]; W, D, H = SIZE[room]
    box(f"{room}_floor", (W, D, 1), (cx, 0, 0.5), mat=M['interior_floor'], anchor=f"interior-floor-{room}")
    box(f"{room}_ceiling", (W, D, 1), (cx, 0, H - 0.5), mat=M['interior_wall'], anchor=f"interior-ceiling-{room}")
    box(f"{room}_wall_back", (W, 1, H), (cx, D / 2, H / 2), mat=M['interior_wall'], anchor=room)
    box(f"{room}_wall_l", (1, D, H), (cx - W / 2, 0, H / 2), mat=M['interior_wall'], anchor=room)
    box(f"{room}_wall_r", (1, D, H), (cx + W / 2, 0, H / 2), mat=M['interior_wall'], anchor=room)
    # front wall in two segments (door gap in the middle)
    seg = (W - 14) / 2
    box(f"{room}_wall_f1", (seg, 1, H), (cx - 7 - seg / 2, -D / 2, H / 2), mat=M['interior_wall'], anchor=room)
    box(f"{room}_wall_f2", (seg, 1, H), (cx + 7 + seg / 2, -D / 2, H / 2), mat=M['interior_wall'], anchor=room)
    # gate lintel over the door + gate lights + cyan nav markers at the door
    box(f"lintel_{room}", (15, 1.4, 2.2), (cx, -D / 2, H - 2.6), mat=M['gunmetal'], anchor="interior-gate-lintel")
    for sx in (-1, 1):
        box(f"gatelight_{room}_{sx}", (0.7, 0.5, 1.6), (cx + sx * 7.6, -D / 2 - 0.2, H - 5.5), mat=M['amber_emit_soft'], anchor="interior-gate-lights")
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=0.42, location=(cx + sx * 7.6, -D / 2 - 0.4, 2.2))
        nav = bpy.context.active_object; nav.name = f"navmarker_{room}_{sx}"
        assign(nav, M['cyan_emit']); put(nav, "interior-nav-markers")

for r in ROOMS:
    room_shell(r)

# ================= HANGAR BAY: ship floating at exact centre =================
cx = CX["hangar-bay"]
ship = hull("bay_ship_hull", 12, mat=M['hull_pale'], anchor="interior-bay-ship", loc=(cx, 0, 8.5), rot=(0, 0, math.radians(-90)))
box("bay_ship_canopy", (2.6, 1.7, 0.9), (cx - 2.4, 0, 9.75), mat=M['glass'], anchor="interior-bay-ship", rot=(0, 0, math.radians(-90)))
box("bay_ship_glow", (1.9, 0.5, 1.3), (cx + 6.3, 0, 8.5), mat=M['amber_emit'], anchor="interior-bay-ship", rot=(0, 0, math.radians(-90)))
# blank nameplate in the bay too — same hull identity
box("bay_ship_nameplate_BLANK", (0.14, 2.4, 0.85), (cx - 0.6, 1.95, 8.75), mat=M['basalt_light'], anchor="interior-bay-ship")
# floor markings under the floating ship (amber guide strips, no text)
for sx in (-1, 1):
    box(f"bay_guide_{sx}", (16, 0.7, 0.15), (cx, sx * 5, 1.05), mat=M['amber_emit_soft'], anchor="interior-light-strips")
# user's own smaller craft parked on cradle at the bay side
hull("user_ship_hull", 6.5, mat=M['gunmetal'], anchor="interior-user-ship", loc=(cx + 24, 11, 4.2), rot=(0, 0, math.radians(180)))
box("user_ship_cradle", (5, 3, 2.6), (cx + 24, 11, 1.8), mat=M['gunmetal_dark'], anchor="interior-user-ship")
# bay door lintel (the great door's top beam, front wall)
box("bay_door_lintel_beam", (30, 1.8, 3), (cx, -20, 15), mat=M['gunmetal'], anchor="interior-bay-door-lintel")
box("bay_door_frame_l", (1.8, 1.8, 13), (cx - 15, -20, 6.5), mat=M['gunmetal_dark'], anchor="interior-bay-door-lintel")
box("bay_door_frame_r", (1.8, 1.8, 13), (cx + 15, -20, 6.5), mat=M['gunmetal_dark'], anchor="interior-bay-door-lintel")
# rim arc: great curved rib behind the ship
bpy.ops.mesh.primitive_torus_add(major_radius=30, minor_radius=1.3, major_segments=40, minor_segments=8,
                                 location=(cx, 19, 2), rotation=(math.radians(90), 0, 0))
arc = bpy.context.active_object; arc.name = "hangar_rim_arc"
assign(arc, M['gunmetal']); put(arc, "interior-rim-arc")
for sx in (-1, 1):
    box(f"hangar_strip_{sx}", (60, 0.6, 0.5), (cx, sx * 18.5, 18.6), mat=M['amber_emit_soft'], anchor="interior-light-strips")

# ================= COMMISSION BOARD =================
cx = CX["commission-board"]
box("board_panel", (32, 0.7, 7.5), (cx, 12.4, 6.4), mat=M['gunmetal_dark'], anchor="commission-board")
import random
random.seed(11)
for i in range(18):
    col, row = i % 6, i // 6
    lit = random.random() > 0.25
    box(f"board_cell_{i:02d}", (4.2, 0.25, 1.7), (cx - 13.2 + col * 5.3, 11.95, 8.6 - row * 2.2),
        mat=M['amber_emit_soft'] if lit else M['dark_unlit'], anchor="commission-board")
for i, dx in enumerate((-10, 0, 10)):
    box(f"board_desk_{i}", (7, 2.6, 1.1), (cx + dx, 4, 1.55), mat=M['wood_warm'], anchor="commission-board")
    box(f"board_desk_screen_{i}", (2.6, 0.2, 1.5), (cx + dx, 4.8, 2.9), mat=M['amber_emit_soft'], anchor="commission-board", rot=(math.radians(-18), 0, 0))
    box(f"board_chair_{i}", (1.6, 1.6, 2.2), (cx + dx, 0.8, 1.1), mat=M['gunmetal_dark'], anchor="commission-board")
box("commission_worklight", (20, 3, 0.4), (cx, 0, 11.2), mat=M['amber_emit'], anchor="interior-work-lights")

# ================= FLEET DECK =================
cx = CX["fleet-deck"]
hull("fleet_model_1", 9, mat=M['basalt_light'], anchor="interior-model-fleet-1", loc=(cx - 9, 0, 4.6), rot=(0, 0, math.radians(90)))
box("fleet_stand_1", (6, 3, 3.4), (cx - 9, 0, 1.7), mat=M['gunmetal_dark'], anchor="interior-model-fleet-1")
hull("fleet_model_2", 7, mat=M['gunmetal'], anchor="interior-model-fleet-2", loc=(cx + 10, 3, 4.2), rot=(0, 0, math.radians(-60)))
box("fleet_stand_2", (5, 2.6, 3), (cx + 10, 3, 1.5), mat=M['gunmetal_dark'], anchor="interior-model-fleet-2")
for i in range(4):
    box(f"fleet_rack_{i}", (8, 1.2, 5), (cx - 18 + i * 0.0, -13.5 + i * 0.1, 2.5 + i * 0.0), mat=M['basalt'], anchor="fleet-deck") if False else None
for i, dx in enumerate((-16, -6, 6, 16)):
    box(f"fleet_crate_{i}", (3.4, 3, 2.6), (cx + dx, -12.5, 1.3), mat=M['basalt'] if i % 2 else M['basalt_light'], anchor="fleet-deck")
box("fleet_worklight", (24, 3, 0.4), (cx, 0, 12.2), mat=M['amber_emit'], anchor="interior-work-lights")
for sx in (-1, 1):
    box(f"fleet_strip_{sx}", (40, 0.6, 0.5), (cx, sx * 13.5, 11.6), mat=M['amber_emit_soft'], anchor="interior-light-strips")

# ================= OBSERVATION DECK =================
cx = CX["observation-deck"]
# remove the generic front-wall segments' middle is already a door gap; the viewport
# is a wide glazed band on the front wall: frame + glass + lintel
box("viewport_glass", (34, 0.4, 8.5), (cx, -12.2, 6), mat=M['glass'], anchor="observation-deck")
box("viewport_frame_t", (36, 1.2, 1.2), (cx, -12.2, 10.6), mat=M['gunmetal'], anchor="interior-deck-viewport-lintel")
box("viewport_frame_b", (36, 1.2, 1.2), (cx, -12.2, 1.4), mat=M['gunmetal'], anchor="interior-deck-viewport-lintel")
for sx in (-1, 1):
    box(f"viewport_frame_{sx}", (1.2, 1.2, 10.4), (cx + sx * 17.5, -12.2, 6), mat=M['gunmetal'], anchor="interior-deck-viewport-lintel")
for i, dx in enumerate((-8, 0, 8)):
    box(f"viewport_mullion_{i}", (0.7, 0.9, 9.2), (cx + dx, -12.2, 6), mat=M['gunmetal_dark'], anchor="interior-deck-viewport-lintel")
# the view: wheel arc + planet + stars, outside the glass, part of the deck set
bpy.ops.mesh.primitive_torus_add(major_radius=85, minor_radius=5, major_segments=48, minor_segments=10,
                                 location=(cx - 10, -120, -18), rotation=(math.radians(90), 0, 0))
varc = bpy.context.active_object; varc.name = "view_wheel_arc"
assign(varc, M['basalt']); put(varc, "observation-deck")
sphere("view_planet", 20, (cx + 42, -105, 16), mat=bpy.data.materials.get("MAT_planet_q1") or M['basalt_light'], anchor="observation-deck", seg=24, rings=16)
for i, (sx, sy, sz) in enumerate([(-30, -60, 26), (15, -70, 34), (48, -55, 8), (-52, -80, 12), (5, -50, -2)]):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=0.55, location=(cx + sx, sy, sz))
    st = bpy.context.active_object; st.name = f"view_star_{i}"
    assign(st, M['amber_emit_soft']); put(st, "observation-deck")
# deck furniture: curved console + seats, warm strips
box("obs_console", (14, 2.2, 1.2), (cx, -8, 1.6), mat=M['gunmetal_dark'], anchor="observation-deck")
box("obs_console_glow", (13, 0.3, 0.9), (cx, -8.6, 2.4), mat=M['amber_emit_soft'], anchor="observation-deck", rot=(math.radians(-24), 0, 0))
for i, dx in enumerate((-4, 4)):
    box(f"obs_seat_{i}", (2, 2, 2.4), (cx + dx, -4.5, 1.2), mat=M['wood_warm'], anchor="observation-deck")
box("obs_strip", (30, 0.6, 0.5), (cx, 10.5, 10.8), mat=M['amber_emit_soft'], anchor="interior-light-strips")

b = bounds_of(bpy.data.objects["interior-bay-ship"])
lo, hi = b
report(f"interior-bay-ship bounds centre=({(lo[0]+hi[0])/2:.1f}, {(lo[1]+hi[1])/2:.1f}, {(lo[2]+hi[2])/2:.1f}) — hangar centre is (0,0); ship z-clearance below hull = {lo[2]:.1f}")
save_master()
report("interior build saved")
