"""Stage C step 2: the wheel — 48 instanced rim segments, beacons (every 8th cyan),
hub + spokes, sealed second seam on the rim underside, Harbor Nail mount.
Source check: app wheel = torus radius 210 rotated flat (XZ in three) => ring in
Blender XY plane, axis Z. Lower rim = underside of the rim (Blender -Z)."""
import bpy, sys, math
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

bpy.context.window.scene = bpy.data.scenes["STATION_EXTERIOR"]
M = {k: bpy.data.materials["MAT_" + k] for k in
     ["basalt", "basalt_light", "gunmetal", "gunmetal_dark", "amber_emit",
      "cyan_emit", "seam_old", "dark_unlit", "amber_emit_soft"]}

for n in ("BLOCK_wheel", "BLOCK_hub"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)

# idempotent re-run: clear anything a previous partial run built under these anchors
for anch in ("station-rotating", "relic-mounts"):
    a = bpy.data.objects.get(anch)
    if a:
        for ch in list(a.children_recursive):
            bpy.data.objects.remove(ch, do_unlink=True)

ANCHOR = "station-rotating"
R = 210.0

# ---- one rim segment (built at angle 0, centred on (R,0,0)), joined single mesh ----
seg_parts = []
seg_parts.append(box("seg_main", (26, 26.5, 18), (R, 0, 0), mat=M['basalt']))
seg_parts.append(box("seg_plate", (2.2, 20, 12), (R + 14, 0, 0), mat=M['gunmetal']))
seg_parts.append(box("seg_deck", (18, 20, 1.8), (R, 0, 9.6), mat=M['gunmetal_dark']))
seg_parts.append(box("seg_keel", (16, 18, 2.2), (R, 0, -9.8), mat=M['gunmetal_dark']))
seg_parts.append(box("seg_seat", (4, 4, 2.4), (R, 0, 11.2), mat=M['gunmetal']))
for o in seg_parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = seg_parts[0]
bpy.ops.object.join()
seg0 = bpy.context.active_object
seg0.name = "rim_segment_00"
put(seg0, ANCHOR)
# 47 linked duplicates
for i in range(1, 48):
    th = math.radians(i * 7.5)
    o = seg0.copy()  # shares mesh data (instancing-equivalent for draw estimate)
    o.name = f"rim_segment_{i:02d}"
    o.location = (R * math.cos(th), R * math.sin(th), 0)
    o.rotation_euler = (0, 0, th)
    bpy.data.collections[ANCHOR].objects.link(o)
    o.parent = bpy.data.objects[ANCHOR]
report("rim segments: 48 (1 mesh + 47 linked duplicates)")

# ---- beacons: 48, every 8th cyan (navigation truth), rest amber ----
def beacon_mesh(name, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=1.15, location=(0, 0, 0))
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    for p in o.data.polygons: p.use_smooth = True
    assign(o, mat)
    bpy.data.objects.remove(o, do_unlink=True)  # keep only the datablock
    return bpy.data.meshes[name]

bm_amber = beacon_mesh("beacon_amber_mesh", M['amber_emit'])
bm_cyan = beacon_mesh("beacon_cyan_mesh", M['cyan_emit'])
cyan_count = 0
for i in range(48):
    th = math.radians(i * 7.5 + 3.75)
    is_cyan = (i % 8 == 0)
    o = bpy.data.objects.new(f"beacon_{i:02d}", bm_cyan if is_cyan else bm_amber)
    o.location = (R * math.cos(th), R * math.sin(th), 12.6)
    bpy.data.collections[ANCHOR].objects.link(o)
    o.parent = bpy.data.objects[ANCHOR]
    if is_cyan: cyan_count += 1
report(f"beacons: 48 placed, cyan={cyan_count} (every 8th), amber={48 - cyan_count}")

# ---- hub + spokes ----
cyl("hub_core", 26, 24, (0, 0, 0), mat=M['gunmetal'], anchor=ANCHOR, verts=24)
cyl("hub_cap", 17, 8, (0, 0, 15), mat=M['basalt'], anchor=ANCHOR, verts=24)
bpy.ops.mesh.primitive_torus_add(major_radius=26.5, minor_radius=1.1, major_segments=32, minor_segments=6, location=(0, 0, 8))
hub_ring = bpy.context.active_object; hub_ring.name = "hub_light_ring"
assign(hub_ring, M['amber_emit_soft']); put(hub_ring, ANCHOR)
for k in range(6):
    th = math.radians(k * 60)
    cx, cy = 111.5 * math.cos(th), 111.5 * math.sin(th)
    box(f"spoke_{k}", (171, 7, 9), (cx, cy, 0), mat=M['basalt'], anchor=ANCHOR, rot=(0, 0, th))
    box(f"spoke_truss_{k}", (150, 2.2, 2.2), (105 * math.cos(th + 0.1), 105 * math.sin(th + 0.1), 6.5),
        mat=M['gunmetal'], anchor=ANCHOR, rot=(0, 0, th + 0.1))
# inner band
bpy.ops.mesh.primitive_torus_add(major_radius=188, minor_radius=3.2, major_segments=64, minor_segments=8, location=(0, 0, 0))
band = bpy.context.active_object; band.name = "inner_band"
assign(band, M['basalt_light']); put(band, ANCHOR)

# ---- second seam: SEALED older joint across the rim underside at 205 deg ----
th = math.radians(205)
sx, sy = R * math.cos(th), R * math.sin(th)
seam = box("second_seam_band", (27.5, 13, 1.4), (sx, sy, -10.2), mat=M['seam_old'], anchor=ANCHOR, rot=(0, 0, th))
for off in (-4.2, 4.2):
    gx, gy = (R) * math.cos(th) - off * math.sin(th), (R) * math.sin(th) + off * math.cos(th)
    box(f"second_seam_groove_{'a' if off < 0 else 'b'}", (27.5, 0.7, 0.5), (gx, gy, -10.9),
        mat=M['dark_unlit'], anchor=ANCHOR, rot=(0, 0, th))
report("second seam modelled SEALED on rim underside (band + grooves, no opening, no glow)")

# ---- Harbor Nail resting-place mount (relic-mounts; relic model NOT in export) ----
th = math.radians(160)
nx, ny = R * math.cos(th), R * math.sin(th)
cyl("nail_mount_plinth", 3.2, 1.6, (nx, ny, -10.6), mat=M['gunmetal'], anchor="relic-mounts", verts=16)
cyl("nail_mount_head", 0.9, 1.4, (nx, ny, -11.8), mat=M['basalt_light'], anchor="relic-mounts", verts=12)
# Mooring Ring resting place: harbour-edge stone where the road meets (by the drydock apron)
box("mooring_ring_mount", (6, 6, 1.6), (64, -186, 0.8), mat=M['basalt_light'], anchor="relic-mounts")
bpy.ops.mesh.primitive_torus_add(major_radius=2.2, minor_radius=0.45, major_segments=20, minor_segments=6, location=(64, -186, 2.2))
mr = bpy.context.active_object; mr.name = "mooring_ring_mount_ring"
assign(mr, M['gunmetal']); put(mr, "relic-mounts")

b = bounds_of(bpy.data.objects[ANCHOR])
lo, hi = b
report(f"station-rotating bounds size=({hi[0]-lo[0]:.1f}, {hi[1]-lo[1]:.1f}, {hi[2]-lo[2]:.1f}) centre=({(lo[0]+hi[0])/2:.1f}, {(lo[1]+hi[1])/2:.1f}, {(lo[2]+hi[2])/2:.1f})")
save_master()
report("wheel build saved")
