"""Reset the bake base onto the pre-bake master (post-detail, pre-bake state):
- delete ALL GS_SURFACE* groups, rebuild one good group, re-point every
  P2 material's GRP node at it (including .001 duplicates);
- normalise the rim segment's slots to the base material names;
- drop stale BAKED_fallback / BAKED_drydock_witness materials + their TEX
  images (hollow-group smoke bakes baked into the pre-bake copy);
- scan-verify: no mesh slot references a wrong-group material. Save."""
import bpy, sys, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *

for gname in [g.name for g in bpy.data.node_groups if g.name.startswith("GS_SURFACE")]:
    bpy.data.node_groups.remove(bpy.data.node_groups[gname])
    report(f"removed group {gname}")
G = p2_lib._new_group()
outn = [nd for nd in G.nodes if nd.bl_idname == 'NodeGroupOutput'][0]
assert all(s.links for s in outn.inputs if s.name), "new group incomplete"
report(f"rebuilt GS_SURFACE: {len(G.nodes)} nodes, outputs linked")

n = 0
for m in bpy.data.materials:
    if m.use_nodes:
        grp = m.node_tree.nodes.get("GRP")
        if grp and grp.node_tree != G:
            grp.node_tree = G
            n += 1
report(f"re-pointed {n} materials")

# apply the gentler plate-tint / finer plate-scale parameters to the EXISTING
# P2 materials (their GRP input defaults were baked in at creation time).
SPEC = {
    "P2_basalt_plate":   ((0.150, 0.160, 0.188), (0.190, 0.200, 0.232), 10.0, 0.35, 0.82, 0.22, 0.55),
    "P2_basalt_light":   ((0.245, 0.260, 0.293), (0.285, 0.300, 0.333), 7.0, 0.30, 0.78, 0.22, 0.45),
    "P2_gunmetal":       ((0.215, 0.230, 0.260), (0.255, 0.270, 0.300), 6.5, 0.80, 0.48, 0.30, 0.40),
    "P2_gunmetal_dark":  ((0.085, 0.092, 0.105), (0.108, 0.117, 0.132), 6.0, 0.72, 0.56, 0.28, 0.45),
    "P2_hull_pale":      ((0.355, 0.373, 0.392), (0.402, 0.420, 0.438), 4.5, 0.50, 0.42, 0.26, 0.35),
    "P2_deck_plate":     ((0.128, 0.138, 0.157), (0.155, 0.165, 0.185), 4.5, 0.55, 0.60, 0.30, 0.60),
    "P2_interior_wall":  ((0.305, 0.290, 0.260), (0.345, 0.330, 0.297), 7.0, 0.15, 0.72, 0.20, 0.30),
    "P2_wood_warm":      ((0.30, 0.185, 0.095), (0.20, 0.12, 0.06), 2.2, 0.0, 0.80, 0.20, 0.25),
    "P2_seam_old":       ((0.095, 0.085, 0.068), (0.118, 0.105, 0.085), 3.0, 0.40, 0.95, 0.15, 0.70),
    "P2_paper_pale":     ((0.545, 0.495, 0.405), (0.515, 0.465, 0.375), 1.8, 0.0, 0.92, 0.10, 0.30),
    "P2_marking_pale":   ((0.505, 0.487, 0.427), (0.475, 0.455, 0.40), 2.4, 0.05, 0.85, 0.15, 0.50),
}
applied = 0
for mname, (a, b, plate, metal, rough, rvar, grime) in SPEC.items():
    m = bpy.data.materials.get(mname)
    if not m or not m.use_nodes:
        continue
    grp = m.node_tree.nodes.get("GRP")
    if not grp:
        continue
    grp.inputs["BaseA"].default_value = (*a, 1.0)
    grp.inputs["BaseB"].default_value = (*b, 1.0)
    grp.inputs["PlateScale"].default_value = plate
    grp.inputs["Metallic"].default_value = metal
    grp.inputs["RoughBase"].default_value = rough
    grp.inputs["RoughVar"].default_value = rvar
    grp.inputs["GrimeAmt"].default_value = grime
    applied += 1
report(f"applied gentle-plate parameters to {applied} materials")

seg = bpy.data.objects.get("rim_segment_00")
if seg:
    seg.data.materials.clear()
    for nm in ("P2_basalt_plate", "P2_gunmetal", "P2_gunmetal_dark",
               "MAT_amber_emit_soft", "MAT_dark_unlit"):
        seg.data.materials.append(bpy.data.materials[nm])
    report(f"segment slots: {[s.material.name for s in seg.material_slots]}")

for mn in ("BAKED_fallback", "BAKED_drydock_witness"):
    m = bpy.data.materials.get(mn)
    if m:
        bpy.data.materials.remove(m)
        report(f"removed stale {mn}")
for im in [i.name for i in bpy.data.images if i.name.startswith(("TEX_fallback", "TEX_drydock_witness"))]:
    bpy.data.images.remove(bpy.data.images[im])
    report(f"removed stale image {im}")

bad = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for s in o.material_slots:
        m = s.material
        if m and m.use_nodes:
            grp = m.node_tree.nodes.get("GRP")
            if grp and grp.node_tree != G:
                bad.append((o.name, m.name))
report(f"SCAN wrong-group slots after reset: {bad}")
assert not bad

# re-grade for legibility at distance (pass-2 grade was too dark for wide
# shots): exposure up, world ambient partially restored, fills strengthened.
for scn in (bpy.data.scenes["STATION_EXTERIOR"], bpy.data.scenes["STATION_INTERIOR"]):
    scn.view_settings.exposure = 1.45
    if scn.world and scn.world.use_nodes:
        scn.world.node_tree.nodes["Background"].inputs[1].default_value = 0.75
for nm, energy in (("SUN_cool_fill", 1.25), ("SUN_indigo_fill", 0.75), ("SUN_warm_bounce", 1.0)):
    o = bpy.data.objects.get(nm)
    if o:
        o.data.energy = energy
report("re-grade applied: exposure 1.45, world 0.75, fills up")
save_master()
report("RESET BAKE BASE SAVED")
