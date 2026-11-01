"""Fix: hangar ship assembly orientation — hull forward +X, attachments aligned."""
import bpy, sys
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

bpy.context.window.scene = bpy.data.scenes["STATION_INTERIOR"]
h = bpy.data.objects["bay_ship_hull"]
h.rotation_euler = (0, 0, 0)
h.location = (0, 0, 8.5)
c = bpy.data.objects["bay_ship_canopy"]
c.location = (2.4, 0, 9.75); c.rotation_euler = (0, 0, 0)
g = bpy.data.objects["bay_ship_glow"]
g.location = (-6.3, 0, 8.5); g.rotation_euler = (0, 0, 0)
n = bpy.data.objects["bay_ship_nameplate_BLANK"]
n.location = (0.6, 1.95, 8.75); n.dimensions = (2.4, 0.14, 0.85); n.rotation_euler = (0, 0, 0)

b = bounds_of(bpy.data.objects["interior-bay-ship"])
lo, hi = b
report(f"interior-bay-ship bounds centre=({(lo[0]+hi[0])/2:.2f}, {(lo[1]+hi[1])/2:.2f}, {(lo[2]+hi[2])/2:.2f}) size=({hi[0]-lo[0]:.1f} x {hi[1]-lo[1]:.1f} x {hi[2]-lo[2]:.1f}); hangar centre=(0,0); clearance below={lo[2]:.1f}")
save_master()
report("hangar ship fix saved")
