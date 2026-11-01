"""Test render cam02 at 50% after the materials pass."""
import bpy, sys, os, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
ext.render.resolution_percentage = 50
ext.camera = bpy.data.objects["cam02_ring_harbor_closeup"]
ext.render.filepath = P2_DIR + "/test_cam02_materials.png"
bpy.ops.render.render(write_still=True)
ext.render.resolution_percentage = 100
report("test render done: " + str(os.path.getsize(ext.render.filepath)) + " B")
# sanity: which suns exist now
report("suns: " + str([(o.name, round(o.data.energy, 2)) for o in bpy.data.objects if o.type == 'LIGHT' and o.data.type == 'SUN']))
