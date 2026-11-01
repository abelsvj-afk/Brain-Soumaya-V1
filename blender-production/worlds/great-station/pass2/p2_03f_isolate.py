import bpy, sys, os, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
from mathutils import Vector

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
cam_data = bpy.data.cameras.new("diag_cam"); cam_data.lens = 42
cam = bpy.data.objects.new("diag_cam", cam_data)
ext.collection.objects.link(cam)
cam.location = (258, -38, 22)
d = Vector((207, 2, 0)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
ext.camera = cam
ext.render.resolution_percentage = 12
bg = ext.world.node_tree.nodes["Background"]
orig = (tuple(bg.inputs[0].default_value), bg.inputs[1].default_value)

def shot(tag):
    ext.render.filepath = P2_DIR + f"/iso_{tag}.png"
    bpy.ops.render.render(write_still=True)
    report(f"iso {tag}: {os.path.getsize(ext.render.filepath)} B")

shot("a_current")
bg.inputs[1].default_value = 0.0
shot("b_world0")
bg.inputs[0].default_value = (1.0, 0.0, 0.0, 1.0)
bg.inputs[1].default_value = 1.0
shot("c_worldred")
bg.inputs[0].default_value = orig[0]; bg.inputs[1].default_value = orig[1]
ext.camera = bpy.data.objects["cam02_ring_harbor_closeup"]
shot("d_cam02")
ext.render.resolution_percentage = 100
bpy.data.objects.remove(cam, do_unlink=True)
report("isolate done")
