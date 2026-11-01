import bpy, sys, time, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
t0 = time.time()
objs = holder_meshes("station-traffic-fallback")
report(f"smoke: baking {len(objs)} fallback objects")
info = bake_group(objs, "fallback", "station-traffic-fallback", res=256, use_ao=False)
report(f"smoke done in {time.time()-t0:.1f}s -> {info}")
save_master()
