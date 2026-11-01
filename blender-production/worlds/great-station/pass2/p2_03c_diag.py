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
ext.render.resolution_percentage = 50
ext.camera = cam
ext.render.filepath = P2_DIR + "/test_seg00_diag.png"
bpy.ops.render.render(write_still=True)
ext.render.resolution_percentage = 100
bpy.data.objects.remove(cam, do_unlink=True)
report("diag render: " + str(os.path.getsize(ext.render.filepath)) + " B")
