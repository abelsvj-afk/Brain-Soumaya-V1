"""Stage C step 7b: grade/composition fixes after first render review, then re-render all six.
Fixes: camera clip_end 1000 -> 9000 (planets/dome were clipped); world strength
0.5 -> 0.22 (true indigo); interior light energies /4 (blowout); interior wall
darker; hull paler-grey; glass made genuinely transparent; observation view arc
raised into the window band; cam05 closer; cam06 pulled back; cool fill inside."""
import bpy, sys, math, os
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *
from mathutils import Vector

PREVIEWS = "/home/hatch/workspace/Soumaya-Environment-Production/previews"
ext = bpy.data.scenes["STATION_EXTERIOR"]
intr = bpy.data.scenes["STATION_INTERIOR"]

def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

# cameras: clip + two repositions
for nm in ("cam01_exterior_overview", "cam02_ring_harbor_closeup", "cam03_drydock_and_ships", "cam04_annexes"):
    c = bpy.data.objects[nm]; c.data.clip_end = 9000
for nm in ("cam05_interior_hangar", "cam06_interior_observation"):
    c = bpy.data.objects[nm]; c.data.clip_end = 9000
c5 = bpy.data.objects["cam05_interior_hangar"]
c5.location = (-19, -10.5, 8.4); c5.data.lens = 30; look_at(c5, (3, 1.5, 8.4))
c6 = bpy.data.objects["cam06_interior_observation"]
c6.location = (300, 9.0, 6.2); c6.data.lens = 30; look_at(c6, (299, -16, 5.8))

# exterior grade
ext.world.node_tree.nodes["Background"].inputs[1].default_value = 0.22
ext.view_settings.exposure = 1.02
sun = bpy.data.objects["SUN_cold_key"]; sun.data.energy = 3.1
# interior grade
intr.view_settings.exposure = 0.95
energies = {"PT_hangar_key": 15000, "PT_hangar_fill": 5000, "PT_commission": 7000,
            "PT_fleet": 8500, "PT_observation_warm": 5500, "PT_observation_cool": 3200}
for nm, e in energies.items():
    bpy.data.objects[nm].data.energy = e
cool = bpy.data.objects["PT_observation_cool"]; cool.location = (300, -5, 8.5)

# materials: darker interior walls, calmer hull, real glass
def set_base(mat_name, rgb):
    m = bpy.data.materials[mat_name]
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1.0)
set_base("MAT_interior_wall", (0.205, 0.2, 0.195))
set_base("MAT_hull_pale", (0.47, 0.49, 0.52))
glass = bpy.data.materials["MAT_glass"]
gbsdf = glass.node_tree.nodes["Principled BSDF"]
gbsdf.inputs["Alpha"].default_value = 0.16
gbsdf.inputs["Roughness"].default_value = 0.08
try:
    glass.surface_render_method = 'DITHERED'
except Exception as e:
    report(f"glass render method: {e}")

# observation view: raise the wheel arc into the window band
arc = bpy.data.objects["view_wheel_arc"]
arc.location = (288, -105, 6)
pl = bpy.data.objects["view_planet"]
pl.location = (344, -100, 18)

save_master()
report("grade fixes applied + saved; re-rendering all six")

shots = [
    (ext, "cam01_exterior_overview", PREVIEWS + "/great-station-01-exterior-overview.png"),
    (ext, "cam02_ring_harbor_closeup", PREVIEWS + "/great-station-02-ring-harbor-closeup.png"),
    (ext, "cam03_drydock_and_ships", PREVIEWS + "/great-station-03-drydock-and-ships.png"),
    (ext, "cam04_annexes", PREVIEWS + "/great-station-04-annexes.png"),
    (intr, "cam05_interior_hangar", PREVIEWS + "/great-station-05-interior-hangar.png"),
    (intr, "cam06_interior_observation", PREVIEWS + "/great-station-06-interior-observation-deck.png"),
]
for scene, cam, path in shots:
    bpy.context.window.scene = scene
    scene.camera = bpy.data.objects[cam]
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    report(f"re-rendered {cam} ({os.path.getsize(path)} bytes)")
report("re-render pass complete")
