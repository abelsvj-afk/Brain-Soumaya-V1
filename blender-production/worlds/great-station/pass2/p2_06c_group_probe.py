"""Bisect the GS_SURFACE group in Cycles: render one cube per test material.
Tests: flat P2-like principled (control), full group, group->Emission direct,
voronoi colour only, mix chain only (no voronoi), group without bump."""
import bpy, sys, os, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
import math

# fresh empty scene so nothing interferes
sc = bpy.data.scenes.new("PROBE")
set_scene(sc)
sc.render.engine = 'CYCLES'
sc.cycles.samples = 4
sc.render.resolution_x = 96
sc.render.resolution_y = 96
w = bpy.data.worlds.new("PROBE_WORLD")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
sc.world = w
ld = bpy.data.lights.new("sun", 'SUN'); ld.energy = 3.0
lo = bpy.data.objects.new("sun", ld); sc.collection.objects.link(lo)
lo.rotation_euler = (math.radians(50), 0, math.radians(-30))
cam_d = bpy.data.cameras.new("c")
cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam)
cam.location = (0, -14, 6)
from mathutils import Vector
d = Vector((0, 0, 0)) - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam

def cube(x, mat, name):
    bpy.ops.mesh.primitive_cube_add(location=(x, 0, 0))
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.dimensions = (4, 4, 4)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        o.data.materials.append(mat)
    return o

def variant_mat(name, mode):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.name = "TC"
    grp = nt.nodes.new("ShaderNodeGroup"); grp.name = "GRP"
    grp.node_tree = bpy.data.node_groups["GS_SURFACE"]
    grp.inputs["BaseA"].default_value = (0.25, 0.27, 0.31, 1.0)
    grp.inputs["BaseB"].default_value = (0.38, 0.40, 0.44, 1.0)
    grp.inputs["PlateScale"].default_value = 3.0
    grp.inputs["Metallic"].default_value = 0.2
    grp.inputs["RoughBase"].default_value = 0.7
    grp.inputs["RoughVar"].default_value = 0.25
    grp.inputs["GrimeAmt"].default_value = 0.5
    nt.links.new(tc.outputs["Object"], grp.inputs["Vector"])
    if mode == 'principled':
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        nt.links.new(grp.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(grp.outputs["Roughness"], bsdf.inputs["Roughness"])
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    elif mode == 'emission_color':
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(grp.outputs["Color"], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    elif mode == 'emission_height':
        em = nt.nodes.new("ShaderNodeEmission")
        nt.links.new(grp.outputs["Height"], em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m

full = build_p2_materials()['basalt']
cube(-9, full, "cube_full_group")
cube(-3, variant_mat("T_emission_color", 'emission_color'), "cube_emit_color")
cube(3, variant_mat("T_emission_height", 'emission_height'), "cube_emit_height")
ctrl = make_mat("T_control_flat", (0.2, 0.22, 0.26), metallic=0.2, roughness=0.7)
cube(9, ctrl, "cube_control")
sc.render.filepath = P2_DIR + "/probe_cycles.png"
bpy.ops.render.render(write_still=True)
# sample the render pixels per cube quadrant
import numpy as np
img = bpy.data.images["Render Result"]
wpx, hpx = img.size
px = np.empty(wpx * hpx * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(hpx, wpx, 4)
for i, nm in enumerate(("full_group", "emit_color", "emit_height", "control")):
    cx = int((i + 0.5) * wpx / 4)
    patch = px[int(hpx * 0.4):int(hpx * 0.6), cx - 4:cx + 4, :3]
    report(f"PROBE {nm}: mean RGB = {patch.mean(axis=(0,1)).round(3)}")
report("probe render saved")
bpy.data.scenes.remove(sc)
