"""Stage C step 0: fresh master file, two scenes, materials, exterior anchor skeleton."""
import bpy, sys
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

# NOTE: read_factory_settings kills the MCP addon connection — clean manually instead.
# Idempotent full clean (safe to re-run after a partial failure):
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)
_scenes = list(bpy.data.scenes)
_default = _scenes[0]
for sc in _scenes[1:]:
    bpy.data.scenes.remove(sc)
_default.name = "STATION_EXTERIOR"
bpy.context.window.scene = _default

mats = build_materials()
report(f"materials: {sorted(bpy.data.materials.keys())}")

ext = get_or_create_scene("STATION_EXTERIOR")
intr = get_or_create_scene("STATION_INTERIOR")
# remove the default scene if distinct
for sc in list(bpy.data.scenes):
    if sc.name not in ("STATION_EXTERIOR", "STATION_INTERIOR"):
        bpy.data.scenes.remove(sc)
bpy.context.window.scene = ext

EXTERIOR_ANCHORS = [
    "station-rotating", "station-work-lights", "station-traffic-fallback",
    "witness-drydock-gantry", "witness-hauler",
    "annex-lunar-annex", "annex-colony-ring", "annex-station-stores",
    "annex-model-lunar-annex", "annex-model-colony-ring", "annex-model-station-stores",
    "hero-ship", "backdrop-lava", "backdrop-quaternius-planet-1",
    "docking-shuttle", "harbor-controller-ship",
    "traffic-01", "traffic-02", "traffic-03", "traffic-04", "traffic-05", "traffic-06",
    "docked-01", "docked-02", "docked-03",
    "drydock-main", "drydock-witness",
    "dressing-drydock", "dressing-annex",
    "relic-mounts",
]
root_anchor(ext, "station-world")
for name in EXTERIOR_ANCHORS:
    make_anchor(ext, "station-world", name, parent_name="station-world")

# non-exported reference collection (never parented under station-world)
refc = get_collection(ext, "REF_locked")
camc = get_collection(ext, "CAMERAS_pilot")

# world: cold indigo space
w = bpy.data.worlds.new("WORLD_space")
ext.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs[0].default_value = (*INDIGO, 1.0)
bg.inputs[1].default_value = 0.55

w2 = bpy.data.worlds.new("WORLD_interior")
intr.world = w2
w2.use_nodes = True
w2.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.035, 1.0)
w2.node_tree.nodes["Background"].inputs[1].default_value = 0.4

for sc in (ext, intr):
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x = 1280
    sc.render.resolution_y = 720
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0

save_master()
report("setup complete; scenes: " + ", ".join(s.name for s in bpy.data.scenes))
report("exterior anchors: %d + root" % len(EXTERIOR_ANCHORS))
