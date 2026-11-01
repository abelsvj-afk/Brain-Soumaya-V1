# Growing Place — build_00: scene + all materials (GP set).
import sys
sys.path.append("/home/hatch/workspace/Soumaya-Environment-Production/worlds/growing-place/scripts")
import gp_lib as G

sc = G.get_scene()
G.get_root(sc)

# terrace lawns (per-terrace bake groups)
for t in range(6):
    warm = 1.0 + 0.03 * t
    G.gp_material("GP_lawn_t%d" % t,
                  (0.140 * warm, 0.315, 0.098), (0.225 * warm, 0.415, 0.128),
                  moss=(0.075, 0.155, 0.05), patch=4.2, grain=30.0, moss_amt=0.25,
                  rough=(0.85, 1.0), bake_size=1024, group_key="lawn_t%d" % t)
# riser stone (per-terrace bake groups)
for t in range(6):
    G.gp_material("GP_stone_r%d" % t,
                  (0.315, 0.285, 0.245), (0.42, 0.38, 0.325),
                  moss=(0.145, 0.245, 0.095), patch=6.0, grain=40.0, moss_amt=0.55,
                  rough=(0.9, 1.0), bake_size=512, group_key="stone_r%d" % t)
G.gp_material("GP_stone_under", (0.195, 0.175, 0.155), (0.275, 0.25, 0.215),
              moss=(0.10, 0.17, 0.07), patch=6.0, grain=40.0, moss_amt=0.3,
              rough=(0.9, 1.0), bake_size=512, group_key="stone_under")
G.gp_material("GP_path", (0.545, 0.465, 0.355), (0.635, 0.555, 0.425),
              moss=(0.30, 0.33, 0.16), patch=7.0, grain=46.0, moss_amt=0.15,
              rough=(0.88, 1.0), bake_size=1024, group_key="path")
G.gp_material("GP_trail", (0.50, 0.425, 0.315), (0.585, 0.51, 0.385),
              moss=(0.28, 0.31, 0.15), patch=7.0, grain=46.0, moss_amt=0.2,
              rough=(0.88, 1.0), bake_size=512, group_key="trail")
G.gp_material("GP_stone_edge", (0.355, 0.325, 0.295), (0.45, 0.42, 0.375),
              moss=(0.15, 0.25, 0.10), patch=6.0, grain=40.0, moss_amt=0.4,
              rough=(0.9, 1.0), bake_size=512, group_key="stone_edge")
G.gp_material("GP_lawn_grove", (0.155, 0.345, 0.105), (0.245, 0.445, 0.145),
              moss=(0.08, 0.16, 0.05), patch=4.2, grain=30.0, moss_amt=0.2,
              rough=(0.85, 1.0), bake_size=1024, group_key="lawn_grove")
G.gp_material("GP_foliage_grove", (0.095, 0.255, 0.075), (0.195, 0.395, 0.115),
              moss=(0.06, 0.14, 0.04), patch=3.4, grain=18.0, moss_amt=0.1,
              rough=(0.8, 1.0), bake_size=1024, group_key="foliage_grove")
G.gp_material("GP_bark_grove", (0.225, 0.155, 0.095), (0.315, 0.225, 0.145),
              moss=(0.10, 0.16, 0.06), patch=8.0, grain=30.0, moss_amt=0.35,
              rough=(0.9, 1.0), bake_size=512, group_key="bark_grove")
G.gp_material("GP_foliage_veg", (0.115, 0.275, 0.085), (0.215, 0.415, 0.125),
              moss=(0.07, 0.15, 0.05), patch=4.0, grain=22.0, moss_amt=0.15,
              rough=(0.85, 1.0), bake_size=512, group_key="foliage_veg")
G.gp_material("GP_stone_gather", (0.335, 0.305, 0.265), (0.435, 0.40, 0.35),
              moss=(0.145, 0.245, 0.095), patch=6.0, grain=40.0, moss_amt=0.45,
              rough=(0.9, 1.0), bake_size=512, group_key="stone_gather")
G.gp_material("GP_stone_stand", (0.30, 0.275, 0.245), (0.40, 0.37, 0.325),
              moss=(0.145, 0.245, 0.095), patch=6.0, grain=40.0, moss_amt=0.5,
              rough=(0.9, 1.0), bake_size=512, group_key="stone_stand")
G.gp_material("GP_soil", (0.155, 0.105, 0.065), (0.235, 0.165, 0.105),
              moss=(0.09, 0.14, 0.05), patch=6.5, grain=44.0, moss_amt=0.2,
              rough=(0.95, 1.0), bake_size=512, group_key="soil")
G.gp_material("GP_pod", (0.345, 0.415, 0.155), (0.545, 0.515, 0.215),
              moss=(0.16, 0.22, 0.07), patch=5.0, grain=26.0, moss_amt=0.15,
              rough=(0.5, 0.75), bake_size=512, group_key="pod")
G.gp_material("GP_bark_witness", (0.255, 0.175, 0.105), (0.375, 0.265, 0.165),
              moss=(0.10, 0.17, 0.06), patch=7.0, grain=30.0, moss_amt=0.3,
              rough=(0.88, 1.0), bake_size=1024, group_key="bark_witness")
G.gp_material("GP_foliage_witness", (0.105, 0.275, 0.085), (0.235, 0.435, 0.125),
              moss=(0.06, 0.14, 0.04), patch=3.2, grain=18.0, moss_amt=0.1,
              rough=(0.8, 1.0), bake_size=1024, group_key="foliage_witness")
G.gp_material("GP_deadwood", (0.445, 0.395, 0.345), (0.545, 0.495, 0.435),
              moss=(0.30, 0.30, 0.22), patch=6.0, grain=34.0, moss_amt=0.06,
              rough=(0.9, 1.0), bake_size=512, group_key="deadwood")
G.gp_material("GP_stone_witness", (0.325, 0.295, 0.255), (0.425, 0.39, 0.34),
              moss=(0.145, 0.245, 0.095), patch=6.0, grain=40.0, moss_amt=0.4,
              rough=(0.9, 1.0), bake_size=512, group_key="stone_witness")
G.gp_material("GP_hull", (0.615, 0.595, 0.575), (0.715, 0.695, 0.655),
              moss=(0.30, 0.30, 0.26), patch=5.0, grain=30.0, moss_amt=0.05,
              rough=(0.45, 0.65), metallic=0.15, bake_size=512, group_key="hull")

# literal materials (export losslessly, no bake)
G.lit_material("GP_gold_emit", (0.25, 0.18, 0.05), emission=(1.0, 0.72, 0.28), strength=2.4)
G.lit_material("GP_leaf_gold", (0.72, 0.52, 0.16), emission=(1.0, 0.74, 0.28), strength=0.8, rough=0.35)
G.lit_material("GP_mist", (1.0, 0.95, 0.85), rough=1.0, alpha=0.13)
G.lit_material("GP_flower_gold", (0.92, 0.72, 0.22), rough=0.7)
G.lit_material("GP_flower_cream", (0.93, 0.88, 0.75), rough=0.7)
G.lit_material("GP_flower_violet", (0.60, 0.50, 0.76), rough=0.7)
G.lit_material("GP_leaf_sprout", (0.29, 0.54, 0.17), rough=0.8)
G.sprite_material()

G.save_registry()
print("materials:", len([m for m in __import__('bpy').data.materials if m.name.startswith('GP_')]))
print("bake groups:", sorted(G.BAKE_REGISTRY.keys()))
