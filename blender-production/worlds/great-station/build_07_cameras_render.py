"""Stage C step 7: lighting + CAMERAS_pilot + the six preview renders (EEVEE 1280x720)."""
import bpy, sys, math
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *
from mathutils import Vector

PREVIEWS = "/home/hatch/workspace/Soumaya-Environment-Production/previews"
ext = bpy.data.scenes["STATION_EXTERIOR"]
intr = bpy.data.scenes["STATION_INTERIOR"]

def look_at(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def add_cam(scene, coll_name, name, loc, target, lens=35):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam = bpy.data.objects.new(name, cam_data)
    coll = bpy.data.collections.get(coll_name) or get_collection(scene, coll_name)
    coll.objects.link(cam)
    cam.location = loc
    look_at(cam, target)
    return cam

def add_light(scene, name, ltype, loc, energy, color, rot=(0, 0, 0)):
    ld = bpy.data.lights.new(name, ltype)
    ld.energy = energy
    ld.color = color
    o = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(o)
    o.location = loc
    o.rotation_euler = rot
    return o

def grade(scene):
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 1.15
    scene.eevee.taa_render_samples = 48
    scene.use_nodes = True
    nt = scene.compositing_node_group if hasattr(scene, 'compositing_node_group') else None
    # Blender 4.2: compositor via scene.node_tree
    ntree = scene.node_tree
    ntree.nodes.clear()
    rl = ntree.nodes.new("CompositorNodeRLayers")
    glare = ntree.nodes.new("CompositorNodeGlare")
    glare.glare_type = 'FOG_GLOW'
    glare.quality = 'HIGH'
    glare.threshold = 0.8
    glare.size = 7
    comp = ntree.nodes.new("CompositorNodeComposite")
    ntree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    ntree.links.new(glare.outputs["Image"], comp.inputs["Image"])

# ---------- exterior lighting: one cold key sun + indigo world ----------
bpy.context.window.scene = ext
add_light(ext, "SUN_cold_key", 'SUN', (0, 0, 500), 2.6, (0.75, 0.85, 1.0),
          rot=(math.radians(52), 0, math.radians(-38)))
if ext.world:
    ext.world.node_tree.nodes["Background"].inputs[1].default_value = 0.5
grade(ext)
cam_coll = get_collection(ext, "CAMERAS_pilot")
cams_ext = [
    ("cam01_exterior_overview", (430, -430, 250), (0, 0, 0), 32,
     PREVIEWS + "/great-station-01-exterior-overview.png"),
    ("cam02_ring_harbor_closeup", (268, 30, 30), (140, 150, 4), 40,
     PREVIEWS + "/great-station-02-ring-harbor-closeup.png"),
    ("cam03_drydock_and_ships", (142, -292, 40), (80, -168, 10), 38,
     PREVIEWS + "/great-station-03-drydock-and-ships.png"),
    ("cam04_annexes", (-88, 58, 26), (-205, 132, 8), 36,
     PREVIEWS + "/great-station-04-annexes.png"),
]
for name, loc, tgt, lens, _ in cams_ext:
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    add_cam(ext, "CAMERAS_pilot", name, loc, tgt, lens)

# ---------- interior lighting: warm points per room ----------
bpy.context.window.scene = intr
room_lights = [
    ("PT_hangar_key", (0, -6, 16.5), 60000, (1.0, 0.78, 0.52)),
    ("PT_hangar_fill", (-20, 12, 10), 15000, (1.0, 0.85, 0.65)),
    ("PT_commission", (110, 0, 10), 20000, (1.0, 0.8, 0.55)),
    ("PT_fleet", (200, 0, 11), 24000, (1.0, 0.8, 0.55)),
    ("PT_observation_warm", (300, 5, 9), 14000, (1.0, 0.75, 0.5)),
    ("PT_observation_cool", (300, -16, 7), 9000, (0.6, 0.75, 1.0)),
]
for name, loc, energy, color in room_lights:
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    add_light(intr, name, 'POINT', loc, energy, color)
grade(intr)
cam_coll_i = get_collection(intr, "CAMERAS_pilot")
cams_int = [
    ("cam05_interior_hangar", (-27, -15, 9.5), (6, 3, 8.3), 34,
     PREVIEWS + "/great-station-05-interior-hangar.png"),
    ("cam06_interior_observation", (300, 7.5, 5.6), (301, -16, 6.5), 36,
     PREVIEWS + "/great-station-06-interior-observation-deck.png"),
]
for name, loc, tgt, lens, _ in cams_int:
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    add_cam(intr, "CAMERAS_pilot", name, loc, tgt, lens)

save_master()
report("lights + cameras placed, master saved")

# ---------- render all six ----------
for scene, shots in ((ext, cams_ext), (intr, cams_int)):
    bpy.context.window.scene = scene
    for name, loc, tgt, lens, path in shots:
        scene.camera = bpy.data.objects[name]
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        import os
        sz = os.path.getsize(path) if os.path.exists(path) else -1
        report(f"rendered {name} -> {path.split('/')[-1]} ({sz} bytes)")
report("all six renders complete")
