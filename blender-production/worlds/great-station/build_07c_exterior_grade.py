"""Stage C step 7c: exterior final grade — deep indigo but readable hull.
World 0.22 -> 0.34, exposure 1.02 -> 1.08, plus a dim indigo 'space bounce'
fill sun from below-opposite so shadow sides keep form. Exterior shots only."""
import bpy, sys, math, os
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

PREVIEWS = "/home/hatch/workspace/Soumaya-Environment-Production/previews"
ext = bpy.data.scenes["STATION_EXTERIOR"]
bpy.context.window.scene = ext
ext.world.node_tree.nodes["Background"].inputs[1].default_value = 0.34
ext.view_settings.exposure = 1.08
old = bpy.data.objects.get("SUN_indigo_fill")
if old: bpy.data.objects.remove(old, do_unlink=True)
ld = bpy.data.lights.new("SUN_indigo_fill", 'SUN')
ld.energy = 0.55
ld.color = (0.35, 0.45, 0.78)
o = bpy.data.objects.new("SUN_indigo_fill", ld)
ext.collection.objects.link(o)
o.rotation_euler = (math.radians(-38), 0, math.radians(140))
save_master()
report("exterior fill + grade applied; re-rendering 4 exterior shots")
shots = [
    ("cam01_exterior_overview", PREVIEWS + "/great-station-01-exterior-overview.png"),
    ("cam02_ring_harbor_closeup", PREVIEWS + "/great-station-02-ring-harbor-closeup.png"),
    ("cam03_drydock_and_ships", PREVIEWS + "/great-station-03-drydock-and-ships.png"),
    ("cam04_annexes", PREVIEWS + "/great-station-04-annexes.png"),
]
for cam, path in shots:
    ext.camera = bpy.data.objects[cam]
    ext.render.filepath = path
    bpy.ops.render.render(write_still=True)
    report(f"final exterior render {cam} ({os.path.getsize(path)} bytes)")
report("exterior final pass complete")
