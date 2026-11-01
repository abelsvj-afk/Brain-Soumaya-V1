"""Inspect GS_SURFACE wiring + defaults; render inline (no-group) replica taps."""
import bpy, sys, os, math, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *
from mathutils import Vector

g = bpy.data.node_groups.get("GS_SURFACE")
report(f"group sockets IN: {[(s.name, s.socket_type) for s in g.interface.items_tree if s.in_out == 'INPUT']}")
report(f"group sockets OUT: {[(s.name, s.socket_type) for s in g.interface.items_tree if s.in_out == 'OUTPUT']}")
for nd in g.nodes:
    if nd.bl_idname in ('NodeGroupInput', 'NodeGroupOutput'):
        continue
    ins = []
    for i, s in enumerate(nd.inputs):
        link = f" <- {s.links[0].from_node.name}.{s.links[0].from_socket.name}" if s.links else ""
        dv = getattr(s, 'default_value', None)
        try:
            dv = tuple(round(c, 2) for c in dv) if hasattr(dv, '__len__') else round(float(dv), 3)
        except Exception:
            dv = '?'
        ins.append(f"{s.name}={dv}{link}")
    report(f"  node {nd.name} [{nd.bl_idname}] " + "; ".join(ins))
m = bpy.data.materials.get("P2_basalt_plate")
grp = m.node_tree.nodes.get("GRP")
report("P2_basalt GRP defaults: " + str({i.name: (tuple(round(c, 2) for c in i.default_value) if hasattr(i.default_value, '__len__') else round(float(i.default_value), 3)) for i in grp.inputs}))
tc = m.node_tree.nodes.get("TC")
report("TC->GRP link: " + str([(l.from_socket.name, l.to_socket.name) for l in m.node_tree.links if l.from_node == tc]))

# ---- inline replica scene: voronoi->bw->emission, and constant colour control ----
sc = bpy.data.scenes.new("PROBE2")
set_scene(sc)
sc.render.engine = 'CYCLES'
sc.cycles.samples = 4
sc.render.resolution_x = 128
sc.render.resolution_y = 64
w = bpy.data.worlds.new("PW2"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.4, 0.4, 0.4, 1)
sc.world = w
cam_d = bpy.data.cameras.new("c2"); cam = bpy.data.objects.new("c2", cam_d)
sc.collection.objects.link(cam)
cam.location = (0, -16, 4)
cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.camera = cam

def cube(x, mat, name):
    bpy.ops.mesh.primitive_cube_add(location=(x, 0, 0))
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.dimensions = (3.6, 3.6, 3.6)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(mat)
    return o

def inline_mat(name, mode):
    mm = bpy.data.materials.new(name); mm.use_nodes = True
    nt = mm.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tcx = nt.nodes.new("ShaderNodeTexCoord")
    em = nt.nodes.new("ShaderNodeEmission")
    if mode == 'voronoi':
        vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.feature_type = 'F1'
        vor.inputs["Scale"].default_value = 0.35
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(tcx.outputs["Object"], vor.inputs["Vector"])
        nt.links.new(vor.outputs["Color"], bw.inputs["Color"])
        nt.links.new(bw.outputs["Val"], em.inputs["Color"])
    elif mode == 'const':
        em.inputs["Color"].default_value = (0.3, 0.35, 0.4, 1.0)
    elif mode == 'group_emit':
        gr = nt.nodes.new("ShaderNodeGroup"); gr.node_tree = g
        gr.inputs["BaseA"].default_value = (0.25, 0.27, 0.31, 1.0)
        gr.inputs["BaseB"].default_value = (0.38, 0.40, 0.44, 1.0)
        gr.inputs["PlateScale"].default_value = 3.0
        gr.inputs["Metallic"].default_value = 0.2
        gr.inputs["RoughBase"].default_value = 0.7
        gr.inputs["RoughVar"].default_value = 0.25
        gr.inputs["GrimeAmt"].default_value = 0.5
        nt.links.new(tcx.outputs["Object"], gr.inputs["Vector"])
        nt.links.new(gr.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mm

cube(-6, inline_mat("I_voronoi", 'voronoi'), "cube_voronoi")
cube(0, inline_mat("I_const", 'const'), "cube_const")
cube(6, inline_mat("I_group", 'group_emit'), "cube_group")
sc.render.filepath = P2_DIR + "/probe2_cycles.png"
bpy.ops.render.render(write_still=True)
report("probe2 saved")
bpy.data.scenes.remove(sc)
