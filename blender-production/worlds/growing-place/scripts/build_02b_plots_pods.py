# Growing Place — build_02b: journey plots, seed pods, warm halos.
import sys, math, random
sys.path.append("/home/hatch/workspace/Soumaya-Environment-Production/worlds/growing-place/scripts")
import bpy
from mathutils import Matrix, Vector, Euler
import gp_lib as G
from gp_layout import GROVES, PLOTS, PATH_R, RAMP_AZ

G.load_registry()
sc = G.get_scene()
RADII, HEIGHTS = G.RADII, G.HEIGHTS
rng = random.Random(777)

def M(pos, rot=(0, 0, 0), s=1.0):
    if isinstance(s, (int, float)):
        s = (s, s, s)
    return Matrix.LocRotScale(Vector(pos), Euler(rot), Vector(s))

bases = G.Geo()      # worn-earth discs grounding each plot (GP_soil)
gather = G.Geo()     # GP_stone_gather
soil_m = G.Geo()     # GP_soil mounds
sprout_l = G.Geo()   # GP_leaf_sprout
stand = G.Geo()      # GP_stone_stand
wild = G.Geo()       # GP_foliage_veg

for p in PLOTS:
    cx, cy, H = p["x"], p["y"], p["z"]
    bg = G.Geo()
    bg.annulus(1.0, 19.0, lambda r, th: 0.16, seg=36, rings=2, uv_scale=1.0 / 130.0)
    bases.merge(bg, Matrix.Translation((cx, cy, H)))
    fam = p["family"]
    az0 = p["az"]
    if fam == "gathering":
        for i in range(7):
            a = az0 + 2 * math.pi * i / 7
            sx, sy = cx + 11.5 * math.cos(a), cy + 11.5 * math.sin(a)
            st = G.Geo()
            st.box((0, 0, 0), (3.4, 1.7, 1.15))
            gather.merge(st, M((sx, sy, H + 0.35), (0, 0, a + math.pi / 2), 1.0))
        disc = G.Geo()
        disc.lathe([(0.0, 0.0, 0.0), (3.2, 0.0, 0.0), (3.2, 0.65, 0.3), (0.0, 0.8, 1.0)], seg=18)
        gather.merge(disc, Matrix.Translation((cx, cy, H)))
    elif fam == "sprout":
        mound = G.Geo()
        mound.blob((0, 0, 0), 9.5, subdv=2, disp=0.12, seed=cx, squash=0.34)
        soil_m.merge(mound, Matrix.Translation((cx, cy, H - 0.4)))
        for i in range(9):
            a = rng.uniform(0, 6.28)
            rad = rng.uniform(1.5, 7.0)
            sx, sy = cx + rad * math.cos(a), cy + rad * math.sin(a)
            sz = H + 2.4 + rng.uniform(-0.4, 0.4)
            sprout_l.tube((sx, sy, H + 0.4), (sx, sy, sz), 0.14, 0.10, sides=5)
            for sgn in (-1, 1):
                lf = G.Geo()
                lf.blob((0, 0, 0), 0.85, subdv=0, disp=0.1, seed=sx + sgn, squash=0.45)
                sprout_l.merge(lf, M((sx + 0.55 * sgn, sy, sz + 0.35),
                                     (0.5 * sgn, 0, a), (1.0, 0.6, 1.0)))
    elif fam == "stone":
        for i, (off, hgt, tilt) in enumerate([(0.0, 6.2, 0.05), (7.5, 4.6, -0.09),
                                              (-6.5, 5.2, 0.12), (3.0, 3.4, 0.0)]):
            a = az0 + i * 1.7
            sx, sy = cx + off * math.cos(a), cy + off * math.sin(a)
            st = G.Geo()
            st.box((0, 0, 0), (2.3, 1.5, hgt))
            stand.merge(st, M((sx, sy, H + hgt * 0.32), (tilt, tilt * 0.6, a), 1.0))
        for i in range(5):
            a = rng.uniform(0, 6.28)
            sx, sy = cx + rng.uniform(9, 14) * math.cos(a), cy + rng.uniform(9, 14) * math.sin(a)
            st = G.Geo()
            st.box((0, 0, 0), (1.1, 0.9, 0.7))
            stand.merge(st, M((sx, sy, H + 0.2), (0, 0, a), 1.0))
    elif fam == "wild":
        for i in range(11):
            a = rng.uniform(0, 6.28)
            rad = rng.uniform(2.0, 13.0)
            sx, sy = cx + rad * math.cos(a), cy + rad * math.sin(a)
            tuft = G.Geo()
            tuft.lathe([(0.0, 0.0, 0.0), (0.6, 0.0, 0.0), (0.34, 1.2, 0.35),
                        (0.15, 2.4, 0.7), (0.0, 3.2, 1.0)], seg=6)
            wild.merge(tuft, M((sx, sy, H - 0.15), (0, 0, a), rng.uniform(1.1, 1.8)))
        for i in range(3):
            a = rng.uniform(0, 6.28)
            sx, sy = cx + rng.uniform(6, 11) * math.cos(a), cy + rng.uniform(6, 11) * math.sin(a)
            b = G.Geo()
            b.blob((0, 0, 0), rng.uniform(2.2, 3.2), subdv=1, disp=0.25, seed=sx, squash=0.7)
            wild.merge(b, M((sx, sy, H + 1.0), (0, 0, a), 1.0))

def put(geo, name, holder_name, mat_name, key=None):
    if geo.faces:
        ob = geo.to_object(name, G.clear_holder(sc, holder_name), bpy.data.materials[mat_name])
        if key:
            G.register_obj(key, ob.name)
        return ob

# each plot family holder also carries its own base discs -> put bases per family below instead
put(gather, "plots_gathering", "plots-gathering", "GP_stone_gather", "stone_gather")
h = G.holder(sc, "plots-sprout")
if soil_m.faces:
    ob = soil_m.to_object("plots_sprout_soil", h, bpy.data.materials["GP_soil"]); G.register_obj("soil", ob.name)
if sprout_l.faces:
    sprout_l.to_object("plots_sprout_leaves", h, bpy.data.materials["GP_leaf_sprout"])
put(stand, "plots_stone", "plots-stone", "GP_stone_stand", "stone_stand")
put(wild, "plots_wild", "plots-wild", "GP_foliage_veg", "foliage_veg")
# base discs go to the soil bake group, parked in plots-gathering's sibling holder set:
hb = G.holder(sc, "plots-gathering")
if bases.faces:
    ob = bases.to_object("plots_base_discs", hb, bpy.data.materials["GP_soil"]); G.register_obj("soil", ob.name)

# ---- seed pods
pod_local = G.Geo()
pod_local.tube((0, 0, 0), (0, 0, 1.15), 0.13, 0.10, sides=6)
pod_local.lathe([(0.02, 1.0, 0.0), (0.85, 1.15, 0.12), (1.18, 1.8, 0.4),
                 (0.98, 2.7, 0.68), (0.48, 3.5, 0.9), (0.02, 3.85, 1.0)], seg=14)
pods = G.Geo()
placed = 0
tries = 0
while placed < 54 and tries < 3000:
    tries += 1
    t = rng.randrange(6)
    side = rng.choice([-1, 1])
    r = PATH_R[t] + side * rng.uniform(13.0, 24.0)
    az = rng.uniform(0, 6.283)
    x, y = r * math.cos(az), r * math.sin(az)
    bad = False
    for rt in (t - 1, t):
        if 0 <= rt < 5:
            da = abs((az - RAMP_AZ[rt] + math.pi) % (2 * math.pi) - math.pi)
            if da < 0.06:
                bad = True
    for g in GROVES:
        if g["t"] == t and math.hypot(x - g["x"], y - g["y"]) < 56:
            bad = True
    if bad:
        continue
    pods.merge(pod_local, M((x, y, HEIGHTS[t] - 0.15), (0, 0, az), rng.uniform(0.85, 1.5)))
    placed += 1
for i in range(5):  # hero pods near the crown court
    az = 0.9 + i * 1.25
    r = rng.uniform(58.0, 88.0)
    pods.merge(pod_local, M((r * math.cos(az), r * math.sin(az), 90 - 0.15), (0, 0, az), rng.uniform(1.6, 2.1)))
put(pods, "seed_pods", "seed-pods", "GP_pod", "pod")
print("pods placed:", placed + 5)

# ---- warm halos: crossed sprite planes over each grove
halos = G.Geo()
for g in GROVES:
    cx, cy, H = g["x"], g["y"], g["z"] + 15.0
    s = 15.0
    halos.quad((cx - s, cy, H), (cx + s, cy, H), (cx + s, cy, H + s * 1.4), (cx - s, cy, H + s * 1.4))
    halos.quad((cx, cy - s, H), (cx, cy + s, H), (cx, cy + s, H + s * 1.4), (cx, cy - s, H + s * 1.4))
    halos.quad((cx - s, cy - s, H + s * 0.7), (cx + s, cy - s, H + s * 0.7),
               (cx + s, cy + s, H + s * 0.7), (cx - s, cy + s, H + s * 0.7))
if halos.faces:
    halos.to_object("warm_halos", G.clear_holder(sc, "warm-halos"),
                    bpy.data.materials["GP_halo_sprite"], smooth=False)
print("plots+pods+halos done")
G.save_registry()
bpy.ops.wm.save_mainfile()
print("SAVED")
