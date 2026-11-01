"""Stage C step 7e: final shot fixes.
Shot 04: camera raised/pulled back so the three annex clusters read as distinct
masses against the rim. Shot 06: a dim cool 'view light' outside the viewport so
the wheel arc + planet are lit; planet moved closer to the view axis."""
import bpy, sys, os
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *
from mathutils import Vector

PREVIEWS = "/home/hatch/workspace/Soumaya-Environment-Production/previews"
ext = bpy.data.scenes["STATION_EXTERIOR"]
intr = bpy.data.scenes["STATION_INTERIOR"]

def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

c4 = bpy.data.objects["cam04_annexes"]
c4.location = (-322, 262, 118); c4.data.lens = 38
look_at(c4, (-182, 118, 2))

old = bpy.data.objects.get("PT_view_cool")
if old: bpy.data.objects.remove(old, do_unlink=True)
ld = bpy.data.lights.new("PT_view_cool", 'POINT')
ld.energy = 26000; ld.color = (0.62, 0.74, 1.0)
o = bpy.data.objects.new("PT_view_cool", ld)
intr.collection.objects.link(o)
o.location = (308, -42, 12)
pl = bpy.data.objects["view_planet"]
pl.location = (320, -72, 13); pl.scale = (1.6, 1.6, 1.6)
save_master()
report("shot fixes applied; re-rendering 04 and 06")

bpy.context.window.scene = ext
ext.camera = c4
p4 = PREVIEWS + "/great-station-04-annexes.png"
ext.render.filepath = p4
bpy.ops.render.render(write_still=True)
report(f"shot 04 re-rendered ({os.path.getsize(p4)} bytes)")

bpy.context.window.scene = intr
intr.camera = bpy.data.objects["cam06_interior_observation"]
p6 = PREVIEWS + "/great-station-06-interior-observation-deck.png"
intr.render.filepath = p6
bpy.ops.render.render(write_still=True)
report(f"shot 06 re-rendered ({os.path.getsize(p6)} bytes)")
