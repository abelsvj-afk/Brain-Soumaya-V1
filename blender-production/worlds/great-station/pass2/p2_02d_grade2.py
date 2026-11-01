import bpy, sys, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
bg = ext.world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.043, 0.063, 0.149, 1.0)
bg.inputs[1].default_value = 0.55
ext.view_settings.exposure = 1.30
cf = bpy.data.objects.get("SUN_cool_fill")
if cf: cf.data.energy = 0.95
wb = bpy.data.objects.get("SUN_warm_bounce")
if wb: wb.data.energy = 0.9
save_master()
report("grade2: world 0.55, exposure 1.30, cool fill 0.95, warm bounce 0.9 — saved")
