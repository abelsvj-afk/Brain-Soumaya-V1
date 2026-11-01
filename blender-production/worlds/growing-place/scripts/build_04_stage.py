# Growing Place — build_04: dawn sky, lights, cameras (all OUTSIDE the export root).
import sys, math
sys.path.append("/home/hatch/workspace/Soumaya-Environment-Production/worlds/growing-place/scripts")
import bpy
from mathutils import Vector
import gp_lib as G

sc = G.get_scene()

# ---- world: dawn gradient (indigo zenith -> gold horizon)
w = bpy.data.worlds.new("GP_world") if not bpy.data.worlds.get("GP_world") else bpy.data.worlds["GP_world"]
sc.world = w
w.use_nodes = True
nt = w.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputWorld')
bg = nt.nodes.new('ShaderNodeBackground')
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.42
ramp.color_ramp.elements[0].color = (0.30, 0.20, 0.10, 1)     # below horizon: warm dark
ramp.color_ramp.elements[1].position = 0.52
ramp.color_ramp.elements[1].color = (0.98, 0.66, 0.34, 1)     # horizon gold
el = ramp.color_ramp.elements.new(0.75)
el.color = (0.13, 0.16, 0.33, 1)                              # upper indigo
el2 = ramp.color_ramp.elements.new(1.0)
el2.color = (0.03, 0.04, 0.10, 1)                             # zenith deep indigo
nt.links.new(tc.outputs['Generated'], sep.inputs['Vector'])
nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.05
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

# ---- lights (scene level, not in export root)
def sun(name, energy, color, rot):
    li = bpy.data.lights.new(name, 'SUN')
    li.energy = energy
    li.color = color
    li.angle = 1.6
    ob = bpy.data.objects.new(name, li)
    ob.rotation_euler = rot
    sc.collection.objects.link(ob)
    return ob

for nm in ("GP_sun", "GP_fill"):
    old = bpy.data.objects.get(nm)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
sun("GP_sun", 3.4, (1.0, 0.76, 0.50), (math.radians(76), math.radians(8), math.radians(-38)))
sun("GP_fill", 0.55, (0.45, 0.55, 0.95), (math.radians(64), math.radians(-10), math.radians(140)))
bpy.data.lights["GP_fill"].use_shadow = False

pl = bpy.data.objects.get("GP_crown_glow")
if pl:
    bpy.data.objects.remove(pl, do_unlink=True)
li = bpy.data.lights.new("GP_crown_glow", 'POINT')
li.energy = 180000.0
li.color = (1.0, 0.78, 0.45)
li.shadow_soft_size = 30.0
ob = bpy.data.objects.new("GP_crown_glow", li)
ob.location = (90, -70, 205)
sc.collection.objects.link(ob)

# ---- cameras
camcoll = sc.collection.children.get("GP_CAMERAS")
if camcoll is None:
    camcoll = bpy.data.collections.new("GP_CAMERAS")
    sc.collection.children.link(camcoll)
for ob in list(camcoll.objects):
    bpy.data.objects.remove(ob, do_unlink=True)

def cam(name, pos, target, lens=35.0):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    ob = bpy.data.objects.new(name, cd)
    ob.location = pos
    d = Vector(target) - Vector(pos)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    camcoll.objects.link(ob)
    return ob

cam("cam_gp01_overview", (1560, -1560, 780), (0, 0, 40), 32)
cam("cam_gp02_meadow", (700, -330, 27), (-140, 90, 135), 38)
cam("cam_gp03_grove_path", (-14, 468, 59), (237, 354, 62), 42)
cam("cam_gp04_witness", (128, -170, 200), (2, 0, 148), 40)

# ---- render settings
sc.render.engine = 'BLENDER_EEVEE_NEXT'
sc.render.resolution_x = 1280
sc.render.resolution_y = 720
sc.render.resolution_percentage = 100
sc.eevee.taa_render_samples = 64
sc.eevee.use_shadows = True
sc.view_settings.view_transform = 'AgX'
sc.view_settings.look = 'AgX - Medium High Contrast'
sc.view_settings.exposure = 1.12
sc.render.image_settings.file_format = 'PNG'
# gentle fog-glow grade, as per the station pass
sc.use_nodes = True
cnt = sc.node_tree
cnt.nodes.clear()
rl = cnt.nodes.new('CompositorNodeRLayers')
gl = cnt.nodes.new('CompositorNodeGlare')
gl.glare_type = 'FOG_GLOW'
gl.quality = 'MEDIUM'
gl.mix = -0.55
gl.threshold = 0.85
gl.size = 7
comp = cnt.nodes.new('CompositorNodeComposite')
cnt.links.new(rl.outputs['Image'], gl.inputs['Image'])
cnt.links.new(gl.outputs['Image'], comp.inputs['Image'])

bpy.ops.wm.save_mainfile()
print("STAGED")
