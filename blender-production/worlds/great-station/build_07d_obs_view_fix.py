"""Stage C step 7d: observation view fix — pull the planet into the window's
view axis, lighten the wheel arc so it reads against space, re-render shot 06 only."""
import bpy, sys, os
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

intr = bpy.data.scenes["STATION_INTERIOR"]
bpy.context.window.scene = intr
arc = bpy.data.objects["view_wheel_arc"]
assign(arc, bpy.data.materials["MAT_basalt_light"])
arc.location = (292, -100, 4)
pl = bpy.data.objects["view_planet"]
pl.location = (326, -86, 15)
pl.scale = (1.3, 1.3, 1.3)
save_master()
intr.camera = bpy.data.objects["cam06_interior_observation"]
path = "/home/hatch/workspace/Soumaya-Environment-Production/previews/great-station-06-interior-observation-deck.png"
intr.render.filepath = path
bpy.ops.render.render(write_still=True)
report(f"shot 06 re-rendered ({os.path.getsize(path)} bytes)")
