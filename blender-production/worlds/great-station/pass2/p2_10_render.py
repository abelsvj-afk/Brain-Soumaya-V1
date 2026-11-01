"""Pass 2 final renders: ONE shot per invocation (SHOT global set by wrapper).
Same cameras as pass 1 final state; output overwrites previews/ (pass-1 copies
are preserved in previews/pass1/). Progress -> render_status.json."""
import bpy, sys, os, json, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *

PREVIEWS = "/home/hatch/workspace/Soumaya-Environment-Production/previews"
SHOTS = {
    "01": ("STATION_EXTERIOR", "cam01_exterior_overview", "great-station-01-exterior-overview.png"),
    "02": ("STATION_EXTERIOR", "cam02_ring_harbor_closeup", "great-station-02-ring-harbor-closeup.png"),
    "03": ("STATION_EXTERIOR", "cam03_drydock_and_ships", "great-station-03-drydock-and-ships.png"),
    "04": ("STATION_EXTERIOR", "cam04_annexes", "great-station-04-annexes.png"),
    "05": ("STATION_INTERIOR", "cam05_interior_hangar", "great-station-05-interior-hangar.png"),
    "06": ("STATION_INTERIOR", "cam06_interior_observation", "great-station-06-interior-observation-deck.png"),
}
scene_name, cam_name, fname = SHOTS[SHOT]
sc = bpy.data.scenes[scene_name]
set_scene(sc)
sc.render.resolution_percentage = 100
sc.camera = bpy.data.objects[cam_name]
sc.render.filepath = PREVIEWS + "/" + fname
bpy.ops.render.render(write_still=True)
sz = os.path.getsize(sc.render.filepath)
STATUS = P2_DIR + "/render_status.json"
st = json.load(open(STATUS)) if os.path.exists(STATUS) else {}
st[SHOT] = {"file": fname, "bytes": sz, "camera": cam_name}
json.dump(st, open(STATUS, "w"), indent=1)
report(f"RENDER {SHOT} {fname}: {sz} B")
