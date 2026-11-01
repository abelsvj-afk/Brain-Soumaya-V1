import bpy, sys, os, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
from mathutils import Vector

# remove orphan cube from the failed first attempt
orphan = bpy.data.objects.get("Cube")
if orphan and orphan.parent is None and orphan.type == 'MESH':
    bpy.data.objects.remove(orphan, do_unlink=True)
    report("orphan Cube removed")
save_master()

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
cam_data = bpy.data.cameras.new("diag_cam"); cam_data.lens = 42
cam = bpy.data.objects.new("diag_cam", cam_data)
ext.collection.objects.link(cam)
cam.location = (258, -38, 22)
d = Vector((207, 2, 0)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
ext.camera = cam
ext.render.resolution_percentage = 25

def shot(tag):
    ext.render.filepath = P2_DIR + f"/diag_{tag}.png"
    bpy.ops.render.render(write_still=True)
    report(f"diag {tag}: {os.path.getsize(ext.render.filepath)} B")

shot("a_asis")
dome = bpy.data.objects.get("star_dome")
dome.hide_render = True
shot("b_nodome")
dome.hide_render = False
ext.use_nodes = False
shot("c_nocomp")
ext.use_nodes = True
ext.render.resolution_percentage = 100
bpy.data.objects.remove(cam, do_unlink=True)
report("diag2 done")
