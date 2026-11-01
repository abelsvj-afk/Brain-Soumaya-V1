"""Headless GLB re-import check: import each exported GLB into a clean scene,
light it neutrally, render stills. Run with the Blender binary in -b mode:
  blender -b --python reimport_check.py
Proves the baked texturing survived export (not just in-Blender beauty)."""
import bpy, os, math
from mathutils import Vector

OUT = "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2"
EXPORTS = "/home/hatch/workspace/Soumaya-Environment-Production/exports"

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def look(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def setup(res=560):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.eevee.taa_render_samples = 8
    sc.eevee.use_bloom = False
    sc.render.resolution_x = res
    sc.render.resolution_y = int(res * 9 / 16)
    sc.render.resolution_percentage = 100
    w = bpy.data.worlds.new("W")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.06, 0.11, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.7
    sc.world = w
    ld = bpy.data.lights.new("sun", 'SUN'); ld.energy = 4.0
    lo = bpy.data.objects.new("sun", ld); sc.collection.objects.link(lo)
    lo.rotation_euler = (math.radians(55), 0, math.radians(-35))
    cd = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cd); sc.collection.objects.link(cam)
    sc.camera = cam
    return sc, cam

def point_light(name, loc, energy, color=(1.0, 0.75, 0.45)):
    ld = bpy.data.lights.new(name, 'POINT'); ld.energy = energy; ld.color = color
    o = bpy.data.objects.new(name, ld); bpy.context.scene.collection.objects.link(o)
    o.location = loc
    return o

# ---- exterior ----
reset()
bpy.ops.import_scene.gltf(filepath=EXPORTS + "/great-station-pilot.glb")
sc, cam = setup()
cam.location = (430, -430, 250); look(cam, (0, 0, 10))
sc.render.filepath = OUT + "/reimport_ext_overview.png"
bpy.ops.render.render(write_still=True)
cam.location = (268, 30, 34); look(cam, (150, 130, 2))
sc.render.filepath = OUT + "/reimport_ext_closeup.png"
bpy.ops.render.render(write_still=True)
print("REIMPORT exterior renders done; objects:", len(bpy.data.objects),
      "images:", [(i.name, tuple(i.size)) for i in bpy.data.images][:40])

# ---- interior ----
reset()
bpy.ops.import_scene.gltf(filepath=EXPORTS + "/great-station-interior-pilot.glb")
sc, cam = setup()
point_light("hangar_key", (0, 0, 26), 40000)
point_light("hangar_fill", (-24, -16, 10), 12000)
cam.location = (-19, -10.5, 8.4); look(cam, (6, 3, 8.3))
sc.render.filepath = OUT + "/reimport_int_hangar.png"
bpy.ops.render.render(write_still=True)
point_light("obs_warm", (300, 0, 9), 8000)
cam.location = (300, 9, 6.2); look(cam, (301, -16, 6.5))
sc.render.filepath = OUT + "/reimport_int_obs.png"
bpy.ops.render.render(write_still=True)
print("REIMPORT interior renders done; objects:", len(bpy.data.objects))
print("REIMPORT CHECK COMPLETE")
