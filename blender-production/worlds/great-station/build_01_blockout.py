"""Stage C step 1: grey-box blockout at true scale + bounding-box verification.
Blender coords: three (x,y,z) -> blender (x,-z,y). Wheel lies in XZ plane (axis Y),
radius 210 in XZ; its vertical extent is Blender Z (exports to three Y)."""
import bpy, sys, math
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

bpy.context.window.scene = bpy.data.scenes["STATION_EXTERIOR"]
M = {k: bpy.data.materials["MAT_" + k] for k in
     ["basalt", "gunmetal", "amber_emit", "cyan_emit", "dark_unlit", "hull_pale"]}
grey = M['basalt']

# --- wheel blockout: flat ring disc (cylinder) radius 210, height 14 ---
cyl("BLOCK_wheel", 210, 14, (0, 0, 0), mat=grey, anchor="station-rotating", verts=48)
cyl("BLOCK_hub", 26, 20, (0, 0, 0), mat=M['gunmetal'], anchor="station-rotating", verts=24)

# --- drydock gantry [88,20,195]_three -> (88,-195,20) ; compact tower ---
box("BLOCK_gantry", (14, 10, 40), (88, -195, 20), mat=M['gunmetal'], anchor="witness-drydock-gantry")

# --- witness drydock berth pad [105,20,177]_three -> (105,-177,20) ---
box("BLOCK_drydock_witness", (30, 22, 4), (105, -177, 2), mat=grey, anchor="drydock-witness")
box("BLOCK_drydock_main", (44, 26, 4), (52, -168, 2), mat=grey, anchor="drydock-main")

# --- witness hauler [30,10,220]_three -> (30,-220,10) ---
hull("BLOCK_hauler", 22, mat=M['gunmetal'], anchor="witness-hauler", loc=(30, -220, 10), rot=(0, 0, math.radians(90)))

# --- hero ship at mooring radius 228, forward length exactly 12 ---
hull("BLOCK_hero", 12, mat=M['hull_pale'], anchor="hero-ship", loc=(80, -214, 4), rot=(0, 0, math.radians(160)))

# --- annex cluster blocks ---
box("BLOCK_annex_lunar", (46, 34, 16), (-170, 120, 8), mat=grey, anchor="annex-lunar-annex")
box("BLOCK_annex_colony", (52, 40, 14), (-235, 30, 7), mat=grey, anchor="annex-colony-ring")
box("BLOCK_annex_stores", (40, 30, 18), (-130, 185, 9), mat=grey, anchor="annex-station-stores")

# --- backdrop planets at ~3,900 ---
sphere("BLOCK_planet_lava", 260, (-2800, 2400, 1200), mat=M['dark_unlit'], anchor="backdrop-lava", seg=24, rings=16)
sphere("BLOCK_planet_q1", 200, (3400, -1600, -600), mat=M['dark_unlit'], anchor="backdrop-quaternius-planet-1", seg=24, rings=16)

# --- verification ---
def centre(b):
    lo, hi = b
    return tuple(round((lo[i] + hi[i]) / 2, 1) for i in range(3)), tuple(round(hi[i] - lo[i], 1) for i in range(3))

b = bounds_of(bpy.data.objects["station-rotating"])
c, s = centre(b)
report(f"station-rotating centre={c} size={s}  (expect centre 0,0,0; XZ extent 420x420)")
b = bounds_of(bpy.data.objects["hero-ship"])
c, s = centre(b)
import math as _m
report(f"hero-ship centre={c} size={s} mooring_radius_xy={round(_m.hypot(c[0], c[1]),1)} (expect 228; longest dim 12)")
b = bounds_of(bpy.data.objects["witness-drydock-gantry"])
c, s = centre(b)
report(f"gantry centre={c} size={s} (expect centre ~(88,-195,20) = three [88,20,195])")
b = bounds_of(bpy.data.objects["witness-hauler"])
c, s = centre(b)
report(f"hauler centre={c} (expect ~(30,-220,10) = three [30,10,220])")
for pname in ("backdrop-lava", "backdrop-quaternius-planet-1"):
    b = bounds_of(bpy.data.objects[pname])
    c, s = centre(b)
    report(f"{pname} centre={c} dist={round(_m.hypot(c[0], _m.hypot(c[1], c[2])),0)} (expect ~4000)")
save_master()
report("blockout saved")
