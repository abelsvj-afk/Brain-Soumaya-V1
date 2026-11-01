# Growing Place — build_03: witness tree (hero), halo, relics, walker, backdrops.
import sys, math
sys.path.append("/home/hatch/workspace/Soumaya-Environment-Production/worlds/growing-place/scripts")
import bpy
from mathutils import Matrix, Vector, Euler
import gp_lib as G

G.load_registry()
sc = G.get_scene()
H = 90.0  # crown surface height

# ---------------- the tree (all bark in one geo, canopy in another)
bark = G.Geo()
# root mound (buried flare the trunk rises from)
bark.lathe([(0.02, H - 2.5, 0.0), (24.0, H - 2.0, 0.25), (29.0, H - 0.4, 0.5),
            (17.0, H + 1.4, 0.8), (0.02, H + 2.4, 1.0)], seg=36)
# trunk — a slight S-curve column
bark.limb([(0, 0, H - 1.5), (1.8, 0.8, H + 14), (4.2, -0.6, H + 32), (5.5, 0.4, H + 50)],
          13.0, 4.5, sides=12)
# root flares
for i in range(7):
    a = i * (2 * math.pi / 7) + 0.35
    ux, uy = math.cos(a), math.sin(a)
    bark.limb([(0.5 * ux, 0.5 * uy, H + 2.2), (10 * ux, 10 * uy, H + 0.6),
               (20 * ux, 20 * uy, H - 0.9)], 3.4, 0.7, sides=7)
# main limbs
limbs = [
    ([(5, 0, H + 48), (16, 4, H + 62), (30, 7, H + 70)], 3.6, 1.1),
    ([(4.5, 1, H + 42), (-6, 12, H + 58), (-16, 24, H + 66)], 3.3, 1.0),
    ([(5.2, -0.5, H + 46), (-2, -14, H + 60), (-6, -27, H + 65)], 3.2, 1.0),
    ([(4, 0.5, H + 38), (18, -9, H + 50), (33, -16, H + 56)], 3.0, 0.9),
    ([(5.5, 0.4, H + 50), (8, 3, H + 66), (10, 5, H + 80)], 3.4, 1.2),
    ([(4.8, -0.2, H + 34), (-14, -4, H + 44), (-26, -7, H + 48)], 2.8, 0.85),
]
for pts, r0, r1 in limbs:
    bark.limb(pts, r0, r1, sides=8)
ob = bark.to_object("witness_tree_bark", G.clear_holder(sc, "witness-tree"),
                    bpy.data.materials["GP_bark_witness"])
G.register_obj("bark_witness", ob.name)

canopy = G.Geo()
for c, r in [((30, 7, H + 76), 20), ((-16, 24, H + 72), 18), ((-6, -27, H + 71), 17),
             ((33, -16, H + 62), 15), ((10, 5, H + 88), 19), ((-26, -7, H + 54), 13),
             ((5, 0, H + 78), 16), ((18, -2, H + 68), 14), ((-2, 12, H + 80), 13)]:
    canopy.blob(c, r, subdv=2, disp=0.20, seed=c[0] * 0.7 + c[1], squash=0.8)
ob = canopy.to_object("witness_tree_canopy", G.holder(sc, "witness-tree"),
                      bpy.data.materials["GP_foliage_witness"])
G.register_obj("foliage_witness", ob.name)

# THE DEAD BOUGH — bare, leaf-less, pointing away toward the hole (-X/+Y, rising).
dead = G.Geo()
dead.limb([(4.6, 0.2, H + 40), (-12, 10, H + 48), (-30, 19, H + 53), (-44, 26, H + 56)],
          1.7, 0.35, sides=7)
dead.limb([(-18, 13.5, H + 50), (-26, 20, H + 56)], 0.42, 0.12, sides=5)
dead.limb([(-30, 19, H + 53), (-38, 27, H + 55)], 0.36, 0.10, sides=5)
ob = dead.to_object("witness_dead_bough", G.holder(sc, "witness-tree"),
                    bpy.data.materials["GP_deadwood"])
G.register_obj("deadwood", ob.name)

# seed-stone prop at the tree (anchors to witness-tree)
ss = G.Geo()
ss.blob((0, 0, 0), 4.0, subdv=2, disp=0.10, seed=3.3, squash=0.55)
ob = ss.to_object("seed_stone", G.holder(sc, "witness-tree"),
                  bpy.data.materials["GP_stone_witness"])
ob.matrix_world = Matrix.LocRotScale(Vector((11, -13, H + 0.6)), Euler((0, 0, 0.7)), Vector((1, 1, 1)))
G.register_obj("stone_witness", ob.name)

# ---------------- witness halo: gold ring (tilted) + soft sprites
halo = G.Geo()
import math as _m
C = Vector((2, 0, H + 78))
e1 = Vector((1, 0, 0))
e2 = Vector((0, _m.cos(_m.radians(66)), _m.sin(_m.radians(66))))
pts = []
for i in range(65):
    a = 2 * _m.pi * i / 64
    p = C + (e1 * _m.cos(a) + e2 * _m.sin(a)) * 37.0
    pts.append(tuple(p))
halo.limb(pts, 0.85, 0.85, sides=6)
ob = halo.to_object("witness_halo_ring", G.clear_holder(sc, "witness-halo"),
                    bpy.data.materials["GP_gold_emit"], smooth=False)
spr = G.Geo()
s = 52.0
spr.quad((C.x - s, C.y, C.z - s * 0.6), (C.x + s, C.y, C.z - s * 0.6),
         (C.x + s, C.y, C.z + s * 0.9), (C.x - s, C.y, C.z + s * 0.9))
spr.quad((C.x, C.y - s, C.z - s * 0.6), (C.x, C.y + s, C.z - s * 0.6),
         (C.x, C.y + s, C.z + s * 0.9), (C.x, C.y - s, C.z + s * 0.9))
spr.to_object("witness_halo_glow", G.holder(sc, "witness-halo"),
              bpy.data.materials["GP_halo_sprite"], smooth=False)

# ---------------- relics
leaf = G.Geo()
leaf.blob((0, 0, 0), 1.0, subdv=1, disp=0.08, seed=1.1, squash=0.4)
leaf.tube((0, 0, -0.2), (0, 0, -1.6), 0.12, 0.08, sides=5)
ob = leaf.to_object("relic_dawn_leaf", G.clear_holder(sc, "relic-dawn-leaf"),
                    bpy.data.materials["GP_leaf_gold"])
ob.matrix_world = Matrix.LocRotScale(Vector((14.5, 6.5, H + 1.1)), Euler((0.15, 0, 0.7)), Vector((3.4, 1.7, 1.0)))
seed = G.Geo()
seed.lathe([(0.02, 0, 0.0), (1.6, 0.15, 0.2), (2.3, 1.2, 0.5), (1.9, 2.6, 0.8), (0.02, 3.6, 1.0)], seg=16)
ob = seed.to_object("relic_witness_seed", G.clear_holder(sc, "relic-witness-seed"),
                    bpy.data.materials["GP_stone_witness"])
ob.matrix_world = Matrix.LocRotScale(Vector((-13.5, -8.5, H - 1.4)), Euler((0, 0, 0.3)), Vector((1, 1, 1)))
G.register_obj("stone_witness", ob.name)

# ---------------- the walker: her ship standing on the arrival meadow
az = 0.9
ax, ay = 845.0 * math.cos(az), 845.0 * math.sin(az)
ship = G.Geo()
ship.blob((0, 0, 0), 1.0, subdv=2, disp=0.05, seed=7.7, squash=0.75)
fin = G.Geo()
fin.box((0, 0, 0), (2.6, 0.35, 2.2))
ship2 = G.Geo()
ship2.merge(ship, Matrix.LocRotScale(Vector((0, 0, 3.4)), Euler((0, 0, 0)), Vector((6.2, 1.9, 1.7))))
ship2.merge(fin, Matrix.LocRotScale(Vector((-4.6, 0, 4.6)), Euler((0, 0.25, 0)), Vector((1, 1, 1))))
for lx, ly in [(-3.4, 1.3), (-3.4, -1.3), (3.6, 0)]:
    ship2.tube((lx, ly, 2.2), (lx * 1.25, ly * 1.5, 0.0), 0.22, 0.3, sides=5)
ob = ship2.to_object("garden_avatar_ship", G.clear_holder(sc, "garden-avatar"),
                     bpy.data.materials["GP_hull"])
ob.matrix_world = Matrix.LocRotScale(Vector((ax, ay, 0.4)), Euler((0, 0, az + math.pi / 2)), Vector((1, 1, 1)))
G.register_obj("hull", ob.name)

carried = G.Geo()
carried.lathe([(0.02, 0, 0.0), (0.85, 0.15, 0.12), (1.18, 0.8, 0.4),
               (0.98, 1.7, 0.68), (0.48, 2.5, 0.9), (0.02, 2.85, 1.0)], seg=12)
ob = carried.to_object("garden_carried_seed", G.clear_holder(sc, "garden-carried"),
                       bpy.data.materials["GP_leaf_gold"])
tx, ty = -math.sin(az), math.cos(az)
ob.matrix_world = Matrix.LocRotScale(Vector((ax + tx * 8.5, ay + ty * 8.5, 3.2)), Euler((0, 0, az)), Vector((0.62, 0.62, 0.62)))

# ---------------- backdrop holders (content = shader planets per spec; holders only)
for name, pos in [("backdrop-planets-set", (-2563.0, 2777.0, 1068.0)),
                  ("backdrop-quaternius-planet-2", (3255.0, -2205.0, 735.0))]:
    coll = G.clear_holder(sc, name)
    em = bpy.data.objects.new(name, None)
    em.empty_display_type = 'PLAIN_AXES'
    em.empty_display_size = 60.0
    em.location = pos
    coll.objects.link(em)

print("witness+relics+walker done")
G.save_registry()
bpy.ops.wm.save_mainfile()
print("SAVED")
