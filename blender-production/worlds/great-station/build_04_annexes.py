"""Stage C step 4: three annex clusters, re-materialed; two lore-dressed doors
(faded ticket — blank pale tag; locked room — barred door). No text anywhere."""
import bpy, sys, math
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

bpy.context.window.scene = bpy.data.scenes["STATION_EXTERIOR"]
M = {k: bpy.data.materials["MAT_" + k] for k in
     ["basalt", "basalt_light", "gunmetal", "gunmetal_dark", "amber_emit", "amber_emit_soft",
      "dark_unlit", "paper_pale", "glass"]}

for n in ("BLOCK_annex_lunar", "BLOCK_annex_colony", "BLOCK_annex_stores"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)

def windows(anchor, cx, cy, cz, n, dx=3.2, rotz=0.0):
    for i in range(n):
        ox = (i - (n - 1) / 2) * dx
        wx = cx + ox * math.cos(rotz)
        wy = cy + ox * math.sin(rotz)
        box(f"{anchor}_win_{i}", (1.5, 0.25, 0.8), (wx, wy, cz), mat=M['amber_emit_soft'], anchor=anchor, rot=(0, 0, rotz))

# ============ lunar annex (-170, 120): domes + module ============
A = "annex-lunar-annex"
d1 = sphere("lunar_dome_a", 13, (-170, 120, 0), mat=M['basalt'], anchor=A, seg=28, rings=14)
d1.scale = (1, 1, 0.55)
d2 = sphere("lunar_dome_b", 9, (-152, 132, 0), mat=M['basalt_light'], anchor=A, seg=24, rings=12)
d2.scale = (1, 1, 0.55)
cyl("lunar_module", 4, 15, (-186, 108, 4), mat=M['gunmetal'], anchor=A, rot=(math.radians(90), 0, math.radians(35)), verts=16)
box("lunar_tunnel", (12, 4, 4.5), (-160, 124, 2.2), mat=M['gunmetal_dark'], anchor=A, rot=(0, 0, math.radians(-30)))
box("lunar_base", (44, 36, 2), (-170, 120, 1), mat=M['gunmetal_dark'], anchor=A)
box("lunar_door", (3.4, 0.5, 5.2), (-170, 101.6, 2.6), mat=M['dark_unlit'], anchor=A)
# the faded ticket: a blank pale tag beside the door — no writing, ever
box("lunar_faded_ticket", (1.0, 0.12, 1.5), (-167.6, 101.4, 3.1), mat=M['paper_pale'], anchor=A, rot=(0, 0, 0.12))
windows(A, -170, 106.5, 5.5, 4)
# annex-model-lunar-annex: representative module on its own plinth
AM = "annex-model-lunar-annex"
cyl("lunar_model_module", 2.6, 9, (-138, 100, 3.4), mat=M['gunmetal'], anchor=AM, rot=(math.radians(90), 0, 0), verts=14)
sphere("lunar_model_cap", 2.6, (-138, 95.6, 3.4), mat=M['basalt_light'], anchor=AM, seg=14, rings=8)
box("lunar_model_plinth", (8, 8, 1.2), (-138, 100, 0.6), mat=M['basalt'], anchor=AM)

# ============ colony ring (-235, 30): small ring habitat on legs ============
A = "annex-colony-ring"
bpy.ops.mesh.primitive_torus_add(major_radius=17, minor_radius=3.1, major_segments=36, minor_segments=10, location=(-235, 30, 12))
ring = bpy.context.active_object; ring.name = "colony_ring_torus"
assign(ring, M['basalt']); put(ring, A)
box("colony_core", (10, 10, 9), (-235, 30, 10.5), mat=M['gunmetal'], anchor=A, bevel=0.3)
for k in range(4):
    th = math.radians(k * 90 + 45)
    box(f"colony_leg_{k}", (1.8, 1.8, 9), (-235 + 13 * math.cos(th), 30 + 13 * math.sin(th), 4.5), mat=M['gunmetal_dark'], anchor=A)
    box(f"colony_spoke_{k}", (11, 1.6, 1.6), (-235 + 8.5 * math.cos(th), 30 + 8.5 * math.sin(th), 12), mat=M['gunmetal'], anchor=A, rot=(0, 0, th))
box("colony_door", (3.2, 0.5, 5), (-235, 19.6, 2.5), mat=M['dark_unlit'], anchor=A)
windows(A, -235, 24.6, 12, 3)
box("colony_base", (46, 40, 1.6), (-235, 30, 0.8), mat=M['gunmetal_dark'], anchor=A)
AM = "annex-model-colony-ring"
bpy.ops.mesh.primitive_torus_add(major_radius=6, minor_radius=1.2, major_segments=20, minor_segments=6, location=(-208, 52, 4.5))
mr = bpy.context.active_object; mr.name = "colony_model_ring"
assign(mr, M['basalt']); put(mr, AM)
box("colony_model_plinth", (10, 10, 1.2), (-208, 52, 0.6), mat=M['basalt'], anchor=AM)

# ============ station stores (-130, 185): warehouse slabs + tanks ============
A = "annex-station-stores"
box("stores_slab_a", (26, 16, 11), (-138, 185, 5.5), mat=M['basalt'], anchor=A, bevel=0.25)
box("stores_slab_b", (18, 13, 8), (-116, 178, 4), mat=M['basalt_light'], anchor=A, bevel=0.25)
box("stores_slab_c", (14, 12, 14), (-146, 196, 7), mat=M['gunmetal'], anchor=A, bevel=0.25)
for i, (tx, ty) in enumerate([(-108, 196), (-102, 190)]):
    cyl(f"stores_tank_{i}", 3.6, 12, (tx, ty, 6), mat=M['gunmetal'], anchor=A, verts=18)
    sphere(f"stores_tank_cap_{i}", 3.6, (tx, ty, 12), mat=M['gunmetal'], anchor=A, seg=18, rings=8)
box("stores_dock", (16, 3, 1.4), (-130, 175.5, 0.7), mat=M['gunmetal_dark'], anchor=A)
# Hesk's locked room: a door that reads LOCKED — panel + crossbars, no lock iconography, no text
box("stores_locked_door", (4.2, 0.5, 6.4), (-130, 176.9, 3.2), mat=M['gunmetal_dark'], anchor=A)
box("stores_locked_bar_a", (4.8, 0.7, 0.7), (-130, 176.5, 4.6), mat=M['basalt_light'], anchor=A, rot=(0, 0, 0.0))
box("stores_locked_bar_b", (4.8, 0.7, 0.7), (-130, 176.5, 2.0), mat=M['basalt_light'], anchor=A)
windows(A, -138, 176.7, 8.6, 4)
AM = "annex-model-station-stores"
box("stores_model_crate_a", (4, 4, 4), (-104, 168, 2), mat=M['basalt_light'], anchor=AM, rot=(0, 0, 0.3))
box("stores_model_crate_b", (3, 3, 3), (-104.5, 168, 5.5), mat=M['gunmetal'], anchor=AM, rot=(0, 0, 0.8))
cyl("stores_model_tank", 2.2, 7, (-98, 172, 3.5), mat=M['gunmetal'], anchor=AM, verts=14)

# ---- dressing-annex: shared clutter between clusters ----
DR = "dressing-annex"
for i, (dx, dy, rz) in enumerate([(-186, 158, 0.2), (-181, 160, 0.7), (-183.5, 158, 0.45)]):
    box(f"annex_crate_{i}", (3.4, 3.4, 3.4), (dx, dy, 1.7 + (3.4 if i == 2 else 0)), mat=M['basalt_light'] if i % 2 else M['gunmetal'], anchor=DR, rot=(0, 0, rz))
for i in range(3):
    cyl(f"annex_barrel_{i}", 1.1, 2.8, (-196 + i * 2.6, 148, 1.4), mat=M['gunmetal_dark'], anchor=DR, verts=10)

for a in ("annex-lunar-annex", "annex-colony-ring", "annex-station-stores"):
    b = bounds_of(bpy.data.objects[a])
    lo, hi = b
    report(f"{a}: centre=({(lo[0]+hi[0])/2:.0f}, {(lo[1]+hi[1])/2:.0f}) size=({hi[0]-lo[0]:.0f} x {hi[1]-lo[1]:.0f} x {hi[2]-lo[2]:.0f})")
save_master()
report("annex build saved")
