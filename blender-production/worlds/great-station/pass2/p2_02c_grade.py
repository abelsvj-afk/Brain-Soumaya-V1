"""Pass 2 grade lift: exposure, world, fills, TAA; re-test cam02 at 50%."""
import bpy, sys, os, math, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *

ext = bpy.data.scenes["STATION_EXTERIOR"]
set_scene(ext)
ext.view_settings.exposure = 1.45
bg = ext.world.node_tree.nodes.get("Background")
bg.inputs[1].default_value = 1.15
b = bpy.data.objects.get("SUN_warm_bounce")
if b:
    b.data.energy = 0.8
if not bpy.data.objects.get("SUN_cool_fill"):
    ld = bpy.data.lights.new("SUN_cool_fill", 'SUN')
    ld.energy = 0.7
    ld.color = (0.45, 0.60, 0.95)
    o = bpy.data.objects.new("SUN_cool_fill", ld)
    ext.collection.objects.link(o)
    o.rotation_euler = (math.radians(-118), 0, math.radians(152))
ext.eevee.taa_render_samples = 24
save_master()
report("grade applied: exposure 1.45, world 1.15, fills set, TAA 24")

ext.render.resolution_percentage = 50
ext.camera = bpy.data.objects["cam02_ring_harbor_closeup"]
ext.render.filepath = P2_DIR + "/test_cam02_grade.png"
bpy.ops.render.render(write_still=True)
ext.render.resolution_percentage = 100
report("grade test render: " + str(os.path.getsize(ext.render.filepath)) + " B")
