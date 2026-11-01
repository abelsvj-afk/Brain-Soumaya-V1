import bpy, sys, time, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
t0 = time.time()
objs = [o for o in holder_meshes("drydock-witness") if not (o.material_slots and o.material_slots[0].material and o.material_slots[0].material.name.startswith("MAT_amber"))]
info = bake_group(objs, "drydock_witness", "drydock-witness", res=512, use_ao=True)
report(f"smoke2 (512px + AO) done in {time.time()-t0:.1f}s -> {info}")
save_master()
