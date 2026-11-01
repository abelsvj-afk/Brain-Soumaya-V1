import bpy, sys, os, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
# args via environment-like globals: CAM name + out file set by wrapper code
sc = bpy.data.scenes["STATION_EXTERIOR" if CAM.startswith(("cam01","cam02","cam03","cam04")) else "STATION_INTERIOR"]
set_scene(sc)
sc.render.resolution_percentage = 50
sc.camera = bpy.data.objects[CAM]
sc.render.filepath = P2_DIR + "/" + OUT
bpy.ops.render.render(write_still=True)
sc.render.resolution_percentage = 100
report(f"test render {CAM}: {os.path.getsize(sc.render.filepath)} B")
