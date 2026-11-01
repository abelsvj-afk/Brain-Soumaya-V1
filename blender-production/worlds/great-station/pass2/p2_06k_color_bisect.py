"""Bisect the GS_SURFACE colour chain in Cycles: for each tap node, copy the
group, rewire its Color output to the tap, render a cube emitting that tap."""
import bpy, sys, math, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
from mathutils import Vector
import numpy as np

src_g = bpy.data.node_groups["GS_SURFACE"]
TAPS = {}
for nd in src_g.nodes:
    TAPS.setdefault(nd.name, nd)

sc = bpy.data.scenes.new("BISECT")
set_scene(sc)
sc.render.engine = 'CYCLES'
sc.cycles.samples = 4
sc.render.resolution_x = 200
sc.render.resolution_y = 60
w = bpy.data.worlds.new("BW"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.0, 0.0, 0.0, 1)
sc.world = w
cam_d = bpy.data.cameras.new("bc")
cam = bpy.data.objects.new("bc", cam_d); sc.collection.objects.link(cam)
cam.location = (0, -30, 3)
cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam

def tap_material(tap_node_name, tap_socket):
    g = src_g.copy()
    g.name = "TAP_" + tap_node_name
    outp = [n for n in g.nodes if n.bl_idname == 'NodeGroupOutput'][0]
    for s in outp.inputs:
        for l in list(s.links):
            g.links.remove(l)
    src_node = g.nodes.get(tap_node_name)
    g.links.new(src_node.outputs[tap_socket], outp.inputs["Color"])
    m = bpy.data.materials.new("TM_" + tap_node_name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    grp = nt.nodes.new("ShaderNodeGroup"); grp.node_tree = g
    grp.inputs["BaseA"].default_value = (0.25, 0.27, 0.31, 1.0)
    grp.inputs["BaseB"].default_value = (0.38, 0.40, 0.44, 1.0)
    grp.inputs["PlateScale"].default_value = 3.0
    grp.inputs["Metallic"].default_value = 0.2
    grp.inputs["RoughBase"].default_value = 0.7
    grp.inputs["RoughVar"].default_value = 0.25
    grp.inputs["GrimeAmt"].default_value = 0.5
    nt.links.new(tc.outputs["Object"], grp.inputs["Vector"])
    nt.links.new(grp.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m

cubes = []
names = []
for nm in src_g.nodes:
    pass
# identify tap candidates by type/name from the source group
cand = []
for nd in src_g.nodes:
    if nd.bl_idname == 'ShaderNodeMixRGB':
        cand.append((nd.name, "Color"))
    if nd.bl_idname == 'ShaderNodeRGBToBW':
        cand.append((nd.name, "Val"))
cand.append(("Group Input", "BaseA"))
report(f"tap candidates: {cand}")
for i, (nm, sock) in enumerate(cand):
    bpy.ops.mesh.primitive_cube_add(location=((i - len(cand) / 2) * 5.0, 0, 0))
    o = bpy.context.view_layer.objects.active
    o.dimensions = (4, 4, 4)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(tap_material(nm, sock))
    names.append(nm)
sc.render.filepath = P2_DIR + "/bisect_color.png"
bpy.ops.render.render(write_still=True)
img = bpy.data.images["Render Result"]
wpx, hpx = img.size
px = np.empty(wpx * hpx * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(hpx, wpx, 4)
for i, nm in enumerate(names):
    cx = int((i + 0.5) * wpx / len(names))
    patch = px[int(hpx * 0.35):int(hpx * 0.65), max(cx - 3, 0):cx + 3, :3]
    report(f"TAP {nm}: mean RGB = {patch.mean(axis=(0, 1)).round(3)}")
bpy.data.scenes.remove(sc)
report("bisect done")
