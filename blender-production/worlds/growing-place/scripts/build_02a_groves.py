# Growing Place — build_02a: grove lawns, trails, trees, flowers, mist, pulse, vegetation.
import sys, math, random
sys.path.append("/home/hatch/workspace/Soumaya-Environment-Production/worlds/growing-place/scripts")
import bpy
from mathutils import Matrix, Vector, Euler
import gp_lib as G
from gp_layout import GROVES, PLOTS, PATH_R, RAMP_AZ

G.load_registry()
sc = G.get_scene()
RADII, HEIGHTS = G.RADII, G.HEIGHTS

def locrots(pos, rotz, s):
    return Matrix.LocRotScale(Vector(pos), Euler((0, 0, rotz)), Vector((s, s, s)))

# ---- tree kit (local space)
def tree_kit(variant):
    trunk, canopy = G.Geo(), G.Geo()
    if variant == "A":
        trunk.limb([(0, 0, 0), (1.2, 0.4, 9), (3.2, -0.4, 17), (4.2, 0, 23)], 2.3, 0.85, sides=7)
        trunk.limb([(3.2, -0.4, 17), (8.5, 2.5, 21.5)], 0.95, 0.4, sides=6)
        trunk.limb([(3.2, -0.4, 17), (-2.5, 4.5, 21)], 0.9, 0.38, sides=6)
        trunk.limb([(1.2, 0.4, 9), (-4.5, -5.5, 15)], 1.05, 0.42, sides=6)
        for c, r in [((4.2, 0, 27.5), 11.5), ((10, 3, 24), 8.5), ((-3.5, 5.5, 24.5), 8.0), ((0.5, -7.5, 21), 7.0)]:
            canopy.blob(c, r, subdv=2, seed=c[0])
    elif variant == "B":
        trunk.limb([(0, 0, 0), (-0.8, 0.6, 12), (-1.5, 0, 26)], 2.0, 0.7, sides=7)
        trunk.limb([(-1.2, 0.3, 19), (5.5, -3.5, 24.5)], 0.85, 0.36, sides=6)
        trunk.limb([(-1.2, 0.3, 19), (-7, -2.5, 23.5)], 0.8, 0.34, sides=6)
        for c, r in [((-1.5, 0, 31), 10.5), ((7, -4, 27), 7.5), ((-7.5, -3, 26.5), 7.0), ((1, 6, 26), 6.5)]:
            canopy.blob(c, r, subdv=2, seed=c[1])
    else:  # C — spreading
        trunk.limb([(0, 0, 0), (0.8, 0, 8), (1.5, 0.5, 14)], 2.6, 1.2, sides=7)
        trunk.limb([(1.5, 0.5, 14), (9, 3, 19)], 1.1, 0.45, sides=6)
        trunk.limb([(1.5, 0.5, 14), (-8.5, 2, 18.5)], 1.05, 0.42, sides=6)
        trunk.limb([(1.5, 0.5, 14), (0, -8, 18)], 1.0, 0.4, sides=6)
        for c, r in [((10.5, 3.5, 22.5), 9.0), ((-10, 2.5, 21.5), 8.5), ((0, -9.5, 21), 8.0), ((1.5, 0.5, 25.5), 10.0)]:
            canopy.blob(c, r, subdv=2, seed=c[0] + c[1])
    return trunk, canopy

KITS = {v: tree_kit(v) for v in "ABC"}

lawns, trails = G.Geo(), G.Geo()
trunks, canopies = G.Geo(), G.Geo()
flowers = {"gold": G.Geo(), "cream": G.Geo(), "violet": G.Geo()}
stems = G.Geo()
pulse = G.Geo()
mist = G.Geo()
rng = random.Random(1234)

for g in GROVES:
    cx, cy, H = g["x"], g["y"], g["z"]
    # lawn (radius 52, local-UV)
    lg = G.Geo()
    lg.annulus(2.0, 52.0, lambda r, th: 0.22, seg=48, rings=2, uv_scale=1.0 / 130.0)
    lawns.merge(lg, Matrix.Translation((cx, cy, H)))
    # trail: curved ribbon from ring path (outward) to grove centre
    az = g["az"]
    ux, uy = math.cos(az), math.sin(az)
    vx, vy = -math.sin(az), math.cos(az)
    p0 = ((PATH_R[g["t"]] - 4.0) * ux, (PATH_R[g["t"]] - 4.0) * uy)
    p1 = (cx, cy)
    steps = 6
    prev = None
    for i in range(steps + 1):
        fr = i / steps
        bx = p0[0] + (p1[0] - p0[0]) * fr + vx * math.sin(fr * math.pi) * 3.0
        by = p0[1] + (p1[1] - p0[1]) * fr + vy * math.sin(fr * math.pi) * 3.0
        row = [(bx - vx * 2.6, by - vy * 2.6, H + 0.20), (bx + vx * 2.6, by + vy * 2.6, H + 0.20)]
        if prev is not None:
            trails.quad(prev[0], prev[1], row[1], row[0],
                        uvs=[(0, fr * 6), (0.16, fr * 6), (0.16, (fr) * 6 + 0.5), (0, fr * 6 + 0.5)])
        prev = row
    # trees around the lawn edge
    nt = 5 + (g["id"] % 4)
    tg, cg = KITS[g["variant"]]
    for i in range(nt):
        a = 2 * math.pi * i / nt + rng.uniform(-0.25, 0.25)
        rad = rng.uniform(38.0, 47.0)
        pos = (cx + rad * math.cos(a), cy + rad * math.sin(a), H - 0.3)
        s = rng.uniform(0.85, 1.3)
        M = locrots(pos, rng.uniform(0, 6.28), s)
        trunks.merge(tg, M)
        canopies.merge(cg, M)
    # flowers sprinkled on the lawn
    accent = ["gold", "cream", "violet"][g["id"] % 3]
    for i in range(26):
        a = rng.uniform(0, 6.28)
        rad = rng.uniform(6.0, 46.0)
        fx, fy = cx + rad * math.cos(a), cy + rad * math.sin(a)
        stems.tube((fx, fy, H + 0.2), (fx, fy, H + 1.0), 0.07, 0.07, sides=4)
        col = accent if i % 3 else ["gold", "cream", "violet"][(g["id"] + 1) % 3]
        flowers[col].blob((fx, fy, H + 1.25), 0.62, subdv=0, disp=0.15, seed=fx)
    # pulse ring at the grove heart
    pg = G.Geo()
    pg.annulus(7.5, 9.5, lambda r, th: 0.30, seg=36, rings=1)
    pulse.merge(pg, Matrix.Translation((cx, cy, H)))

def _put(geo, name, holder_name, mat_name, key=None, smooth=True):
    if not geo.faces:
        return None
    ob = geo.to_object(name, G.clear_holder(sc, holder_name), bpy.data.materials[mat_name], smooth=smooth)
    if key:
        G.register_obj(key, ob.name)
    return ob

_put(lawns, "grove_lawns", "grove-lawns", "GP_lawn_grove", "lawn_grove")
_put(trails, "grove_trails", "grove-trails", "GP_trail", "trail")
_put(trunks, "grove_trunks", "grove-trunks", "GP_bark_grove", "bark_grove")
_put(canopies, "grove_trees", "grove-trees", "GP_foliage_grove", "foliage_grove")
_put(pulse, "grove_pulse", "grove-pulse", "GP_gold_emit", smooth=False)
fh = G.clear_holder(sc, "grove-flowers")
for col, geo in flowers.items():
    if geo.faces:
        geo.to_object("flowers_" + col, fh, bpy.data.materials["GP_flower_" + col])
if stems.faces:
    stems.to_object("flower_stems", fh, bpy.data.materials["GP_leaf_sprout"])

# mist ribbons in the terrace hollows (inner annulus of terraces 1..4)
for t in range(1, 5):
    mist.annulus(RADII[t + 1] + 34.0, RADII[t] - 46.0, lambda r, th, H=HEIGHTS[t]: H + 4.5,
                 seg=120, rings=1)
_put(mist, "grove_mist", "grove-mist", "GP_mist", smooth=False)

# ---- vegetation: grass tufts + bushes across the open terraces
def excluded(x, y, t):
    r = math.hypot(x, y)
    if abs(r - PATH_R[t]) < 12:
        return True
    az = math.atan2(y, x)
    for rt in (t - 1, t):
        if 0 <= rt < 5:
            da = abs((az - RAMP_AZ[rt] + math.pi) % (2 * math.pi) - math.pi)
            if da < 0.055:
                return True
    for g in GROVES:
        if g["t"] == t and math.hypot(x - g["x"], y - g["y"]) < 60:
            return True
    for p in PLOTS:
        if p["t"] == t and math.hypot(x - p["x"], y - p["y"]) < 36:
            return True
    return False

tuft = G.Geo()
tuft.lathe([(0.0, 0.0, 0.0), (0.55, 0.0, 0.0), (0.30, 0.9, 0.35), (0.13, 1.7, 0.7), (0.0, 2.3, 1.0)], seg=6)
veg = G.Geo()
placed = 0
tries = 0
while placed < 650 and tries < 6000:
    tries += 1
    t = rng.randrange(6)
    r_in = RADII[t + 1] if t < 5 else 20.0
    r = rng.uniform(r_in + 14, RADII[t] - 12)
    az = rng.uniform(0, 6.283)
    x, y = r * math.cos(az), r * math.sin(az)
    if excluded(x, y, t):
        continue
    s = rng.uniform(0.8, 1.7)
    veg.merge(tuft, locrots((x, y, HEIGHTS[t] - 0.2), rng.uniform(0, 6.28), s))
    placed += 1
bushes = 0
while bushes < 70 and tries < 9000:
    tries += 1
    t = rng.randrange(6)
    r_in = RADII[t + 1] if t < 5 else 30.0
    r = rng.uniform(r_in + 16, RADII[t] - 14)
    az = rng.uniform(0, 6.283)
    x, y = r * math.cos(az), r * math.sin(az)
    if excluded(x, y, t):
        continue
    bg = G.Geo()
    bg.blob((0, 0, 0), rng.uniform(2.0, 3.6), subdv=1, disp=0.25, seed=x, squash=0.7)
    veg.merge(bg, locrots((x, y, HEIGHTS[t] + 0.9), rng.uniform(0, 6.28), 1.0))
    bushes += 1
_put(veg, "vegetation", "vegetation", "GP_foliage_veg", "foliage_veg")
print("groves+vegetation done; tufts", placed, "bushes", bushes)
G.save_registry()
bpy.ops.wm.save_mainfile()
print("SAVED")
