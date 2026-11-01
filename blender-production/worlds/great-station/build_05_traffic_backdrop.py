"""Stage C step 5: hero ship (modelled stand-in, length 12, BLANK nameplate),
hauler, traffic/docked/shuttle/controller/fallback hulls, backdrop planets
(procedural render materials), star dome.
DECISION (recorded): the hero is a clean modelled stand-in hull — the CC-BY-NC
soumaya-ship.glb is NOT imported (per brief §1.7 'the pilot does not swap the
ship' and the NC licence); hull identity kept: seventh hull, length 12, blank plate."""
import bpy, sys, math, random
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *

bpy.context.window.scene = bpy.data.scenes["STATION_EXTERIOR"]
M = {k: bpy.data.materials["MAT_" + k] for k in
     ["basalt", "basalt_light", "gunmetal", "gunmetal_dark", "amber_emit", "amber_emit_soft",
      "cyan_emit", "dark_unlit", "hull_pale", "glass"]}

for n in ("BLOCK_hero", "BLOCK_hauler", "BLOCK_planet_lava", "BLOCK_planet_q1"):
    o = bpy.data.objects.get(n)
    if o: bpy.data.objects.remove(o, do_unlink=True)

# idempotent re-run: clear children of every anchor this step builds under
for anch in ("hero-ship", "witness-hauler", "docking-shuttle", "harbor-controller-ship",
             "station-traffic-fallback", "backdrop-lava", "backdrop-quaternius-planet-1",
             "traffic-01", "traffic-02", "traffic-03", "traffic-04", "traffic-05", "traffic-06",
             "docked-01", "docked-02", "docked-03"):
    a = bpy.data.objects.get(anch)
    if a:
        for ch in list(a.children_recursive):
            bpy.data.objects.remove(ch, do_unlink=True)
_sd = bpy.data.objects.get("star_dome")
if _sd: bpy.data.objects.remove(_sd, do_unlink=True)

# ================= HERO SHIP — mooring radius 228, length exactly 12 =================
A = "hero-ship"
cx, cy, cz = 80.0, -214.0, 4.0
ang = math.radians(160)
fwd = (math.cos(ang), math.sin(ang))
side = (-math.sin(ang), math.cos(ang))
hero = hull("hero_hull", 12, mat=M['hull_pale'], anchor=A, loc=(cx, cy, cz), rot=(0, 0, ang))
box("hero_canopy", (2.6, 1.7, 0.9), (cx + fwd[0] * 2.4, cy + fwd[1] * 2.4, cz + 1.25), mat=M['glass'], anchor=A, rot=(0, 0, ang))
box("hero_spine", (5.5, 0.9, 0.7), (cx - fwd[0] * 1.5, cy - fwd[1] * 1.5, cz + 1.15), mat=M['gunmetal'], anchor=A, rot=(0, 0, ang))
box("hero_engine_glow", (0.5, 1.9, 1.3), (cx - fwd[0] * 6.3, cy - fwd[1] * 6.3, cz), mat=M['amber_emit'], anchor=A, rot=(0, 0, ang))
# THE NAMEPLATE: a blank rectangle on the hull's flank. No name. No letters. Ever.
box("hero_nameplate_BLANK", (2.4, 0.14, 0.85),
    (cx + side[0] * 1.95 + fwd[0] * 0.6, cy + side[1] * 1.95 + fwd[1] * 0.6, cz + 0.25),
    mat=M['basalt_light'], anchor=A, rot=(0, 0, ang))
report("hero ship: modelled stand-in, length 12, blank rectangular nameplate fitted (unpainted)")

# ================= witness hauler (final) =================
A = "witness-hauler"
hull("hauler_hull", 22, mat=M['gunmetal'], anchor=A, loc=(30, -220, 10), rot=(0, 0, math.radians(90)))
box("hauler_cargo_a", (7, 5, 3.4), (30, -223, 13.4), mat=M['basalt_light'], anchor=A)
box("hauler_cargo_b", (5, 4.4, 2.8), (30, -215.5, 13), mat=M['basalt'], anchor=A)
box("hauler_glow", (2.2, 0.5, 1.4), (30, -231.4, 10), mat=M['amber_emit'], anchor=A)

# ================= traffic lanes (radius ~290-335) =================
random.seed(48)
traffic_specs = [
    ("traffic-01", 13, 292, 18, 26), ("traffic-02", 9, 318, 96, -14),
    ("traffic-03", 11, 300, 168, 42), ("traffic-04", 8, 330, 232, -30),
    ("traffic-05", 14, 288, 288, 16), ("traffic-06", 10, 322, 330, -46),
]
for name, L, rad, deg, z in traffic_specs:
    th = math.radians(deg)
    x, y = rad * math.cos(th), rad * math.sin(th)
    tangent = th + math.radians(90) + (math.radians(180) if name in ("traffic-02", "traffic-05") else 0)
    hull(name + "_hull", L, mat=M['gunmetal'] if L % 2 else M['basalt_light'], anchor=name,
         loc=(x, y, z), rot=(0, 0, tangent))
    box(name + "_glow", (0.4, 1.4, 0.9),
        (x - math.cos(tangent) * (L / 2 + 0.3), y - math.sin(tangent) * (L / 2 + 0.3), z),
        mat=M['amber_emit'], anchor=name, rot=(0, 0, tangent))

# ================= docked hulls near the harbour edge =================
docked_specs = [("docked-01", 10, 246, 128, 6), ("docked-02", 8, 240, 152, -4), ("docked-03", 9, 252, 108, 12)]
for name, L, rad, deg, z in docked_specs:
    th = math.radians(deg)
    x, y = rad * math.cos(th), rad * math.sin(th)
    hull(name + "_hull", L, mat=M['basalt_light'], anchor=name, loc=(x, y, z), rot=(0, 0, th + math.radians(90)))

# ================= shuttle + controller + fallback =================
hull("shuttle_hull", 6, mat=M['hull_pale'], anchor="docking-shuttle", loc=(112, -206, 15), rot=(0, 0, math.radians(200)))
hull("controller_hull", 10, mat=M['gunmetal'], anchor="harbor-controller-ship", loc=(-40, -246, 18), rot=(0, 0, math.radians(75)))
# controller carries a cyan NAV marker — cyan is navigation truth, allowed here
bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.8, location=(-40, -246, 21.6))
nav = bpy.context.active_object; nav.name = "controller_nav_marker"
assign(nav, M['cyan_emit']); put(nav, "harbor-controller-ship")
hull("fallback_hull", 9, mat=M['basalt'], anchor="station-traffic-fallback", loc=(150, 244, -22), rot=(0, 0, math.radians(300)))

# ================= backdrop planets (procedural, render-grade) =================
def planet_mat_lava():
    m = bpy.data.materials.get("MAT_planet_lava") or bpy.data.materials.new("MAT_planet_lava")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.95
    noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 5.0
    noise.inputs["Detail"].default_value = 6.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.55; ramp.color_ramp.elements[0].color = (0.03, 0.02, 0.02, 1)
    ramp.color_ramp.elements[1].position = 0.75; ramp.color_ramp.elements[1].color = (0.25, 0.2, 0.18, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    ramp2 = nt.nodes.new("ShaderNodeValToRGB")
    ramp2.color_ramp.elements[0].position = 0.78; ramp2.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp2.color_ramp.elements[1].position = 0.92; ramp2.color_ramp.elements[1].color = (1.0, 0.32, 0.05, 1)
    nt.links.new(noise.outputs["Fac"], ramp2.inputs["Fac"])
    nt.links.new(ramp2.outputs["Color"], bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 1.6
    return m

def planet_mat_banded():
    m = bpy.data.materials.get("MAT_planet_q1") or bpy.data.materials.new("MAT_planet_q1")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    tex = nt.nodes.new("ShaderNodeTexCoord")
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = 'BANDS'; wave.inputs["Scale"].default_value = 3.0; wave.inputs["Distortion"].default_value = 2.0
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.1, 0.3, 0.38, 1)
    ramp.color_ramp.elements[1].color = (0.55, 0.48, 0.35, 1)
    nt.links.new(tex.outputs["Generated"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    return m

sphere("planet_lava", 260, (-2800, 2400, 1200), mat=planet_mat_lava(), anchor="backdrop-lava", seg=40, rings=26)
sphere("planet_q1", 200, (3400, -1600, -600), mat=planet_mat_banded(), anchor="backdrop-quaternius-planet-1", seg=40, rings=26)

# ================= star dome with generated starfield =================
img = bpy.data.images.get("TEX_stars") or bpy.data.images.new("TEX_stars", 1024, 512, alpha=False)
px = []
base = (0.012, 0.016, 0.045, 1.0)
px = list(base) * (1024 * 512)  # deep indigo base, RGBA
random.seed(7)
for _ in range(2600):
    x = random.randrange(1024); y = random.randrange(512)
    b = random.uniform(0.35, 1.0)
    tint = random.random()
    col = (b, b, b * 1.05) if tint < 0.8 else ((b, b * 0.85, b * 0.6) if tint < 0.92 else (b * 0.7, b * 0.9, b))
    i = (y * 1024 + x) * 4
    px[i:i + 3] = col
img.pixels = px
dome_mat = bpy.data.materials.get("MAT_stardome") or bpy.data.materials.new("MAT_stardome")
dome_mat.use_nodes = True
nt = dome_mat.node_tree
bsdf = nt.nodes["Principled BSDF"]
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 0.7
dome = sphere("star_dome", 6000, (0, 0, 0), mat=dome_mat, anchor=None, seg=32, rings=20)
dome.name = "star_dome"
# dome is scenery, parented to the root only (not an anchor holder)
put(dome, "station-world")
report("backdrop planets + star dome placed (dome parented to station-world root, not an anchor)")
save_master()
report("traffic/backdrop build saved")
