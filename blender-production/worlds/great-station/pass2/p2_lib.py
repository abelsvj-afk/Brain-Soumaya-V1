"""Pass 2 shared library: procedural PBR surface materials (with HEIGHT output
for baking), merge/UV/bake pipeline producing export-safe baked materials,
and small detail helpers. Builds on gs_lib from pass 1."""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector

sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
from gs_lib import *  # noqa: F401,F403  (box, cyl, sphere, cone, hull, put, assign, save_master, report, hexcol...)

P2_DIR = "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2"
TEX_DIR = P2_DIR + "/tex"
os.makedirs(TEX_DIR, exist_ok=True)

# ---------------------------------------------------------------- materials
def _new_group():
    gname = "GS_SURFACE"
    g = bpy.data.node_groups.get(gname)
    if g:
        return g
    g = bpy.data.node_groups.new(gname, 'ShaderNodeTree')
    gi, go = g.interface, None
    gi.new_socket("Vector", in_out='INPUT', socket_type='NodeSocketVector')
    gi.new_socket("BaseA", in_out='INPUT', socket_type='NodeSocketColor')
    gi.new_socket("BaseB", in_out='INPUT', socket_type='NodeSocketColor')
    gi.new_socket("PlateScale", in_out='INPUT', socket_type='NodeSocketFloat')
    gi.new_socket("Metallic", in_out='INPUT', socket_type='NodeSocketFloat')
    gi.new_socket("RoughBase", in_out='INPUT', socket_type='NodeSocketFloat')
    gi.new_socket("RoughVar", in_out='INPUT', socket_type='NodeSocketFloat')
    gi.new_socket("GrimeAmt", in_out='INPUT', socket_type='NodeSocketFloat')
    gi.new_socket("Color", in_out='OUTPUT', socket_type='NodeSocketColor')
    gi.new_socket("Roughness", in_out='OUTPUT', socket_type='NodeSocketFloat')
    gi.new_socket("MetallicOut", in_out='OUTPUT', socket_type='NodeSocketFloat')
    gi.new_socket("Height", in_out='OUTPUT', socket_type='NodeSocketFloat')
    nt = g.nodes
    inp = nt.new("NodeGroupInput"); inp.location = (-900, 0)
    outp = nt.new("NodeGroupOutput"); outp.location = (700, 0)
    L = g.links.new

    def n(t, x, y, **props):
        nd = nt.new(t); nd.location = (x, y)
        for k, v in props.items():
            setattr(nd, k, v)
        return nd

    # plate-scaled coords
    comb = n("ShaderNodeCombineXYZ", -700, 200)
    for i, ax in enumerate(("X", "Y", "Z")):
        L(inp.outputs["PlateScale"], comb.inputs[ax])
    div = n("ShaderNodeVectorMath", -560, 200, operation='DIVIDE')
    L(inp.outputs["Vector"], div.inputs[0]); L(comb.outputs["Vector"], div.inputs[1])
    # cell identity (F1 colour) + edge distance
    vorC = n("ShaderNodeTexVoronoi", -380, 320); vorC.feature = 'F1'; vorC.distance = 'EUCLIDEAN'
    vorC.inputs["Scale"].default_value = 1.0; vorC.inputs["Randomness"].default_value = 1.0
    L(div.outputs["Vector"], vorC.inputs["Vector"])
    vorE = n("ShaderNodeTexVoronoi", -380, 60); vorE.feature = 'DISTANCE_TO_EDGE'; vorE.distance = 'EUCLIDEAN'
    vorE.inputs["Scale"].default_value = 1.0; vorE.inputs["Randomness"].default_value = 1.0
    L(div.outputs["Vector"], vorE.inputs["Vector"])
    bw = n("ShaderNodeRGBToBW", -180, 320)
    L(vorC.outputs["Color"], bw.inputs["Color"])
    # plate tint mix A/B
    mixc = n("ShaderNodeMixRGB", 0, 320); mixc.blend_type = 'MIX'
    L(inp.outputs["BaseA"], mixc.inputs[1]); L(inp.outputs["BaseB"], mixc.inputs[2])
    L(bw.outputs["Val"], mixc.inputs["Fac"])
    # grime: broad noise on raw coords
    nzG = n("ShaderNodeTexNoise", -380, -160); nzG.inputs["Scale"].default_value = 0.055
    nzG.inputs["Detail"].default_value = 3.0
    L(inp.outputs["Vector"], nzG.inputs["Vector"])
    grimeMul = n("ShaderNodeMath", -180, -160, operation='MULTIPLY')
    L(nzG.outputs["Fac"], grimeMul.inputs[0]); L(inp.outputs["GrimeAmt"], grimeMul.inputs[1])
    oneMinus = n("ShaderNodeMath", 0, -160, operation='SUBTRACT')
    oneMinus.inputs[0].default_value = 1.0; L(grimeMul.outputs[0], oneMinus.inputs[1])
    colGrime = n("ShaderNodeMixRGB", 60, 160); colGrime.blend_type = 'MULTIPLY'
    colGrime.inputs["Fac"].default_value = 1.0
    L(mixc.outputs["Color"], colGrime.inputs[1])
    grimeCol = n("ShaderNodeMixRGB", 0, 60); grimeCol.blend_type = 'MIX'
    grimeCol.inputs[1].default_value = (0.35, 0.33, 0.30, 1.0)
    grimeCol.inputs[2].default_value = (1.0, 1.0, 1.0, 1.0)
    L(oneMinus.outputs[0], grimeCol.inputs["Fac"])
    L(grimeCol.outputs["Color"], colGrime.inputs[2])
    # groove mask from edge distance
    ramp = n("ShaderNodeValToRGB", -180, 60)
    ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    ramp.color_ramp.elements[1].position = 0.10; ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
    L(vorE.outputs["Distance"], ramp.inputs["Fac"])
    grooveDark = n("ShaderNodeMixRGB", 200, 160); grooveDark.blend_type = 'MULTIPLY'
    grooveDark.inputs["Fac"].default_value = 1.0
    L(colGrime.outputs["Color"], grooveDark.inputs[1])
    gcol = n("ShaderNodeMixRGB", 60, -40); gcol.blend_type = 'MIX'
    gcol.inputs[1].default_value = (1.0, 1.0, 1.0, 1.0); gcol.inputs[2].default_value = (0.48, 0.48, 0.50, 1.0)
    L(ramp.outputs["Color"], gcol.inputs["Fac"])
    L(gcol.outputs["Color"], grooveDark.inputs[2])
    L(grooveDark.outputs["Color"], outp.inputs["Color"])
    # fine noise -> roughness + micro height
    nzF = n("ShaderNodeTexNoise", -380, -340); nzF.inputs["Scale"].default_value = 1.35
    nzF.inputs["Detail"].default_value = 4.0
    L(inp.outputs["Vector"], nzF.inputs["Vector"])
    rVar = n("ShaderNodeMath", -60, -340, operation='MULTIPLY_ADD')
    L(nzF.outputs["Fac"], rVar.inputs[0]); L(inp.outputs["RoughVar"], rVar.inputs[1]); L(inp.outputs["RoughBase"], rVar.inputs[2])
    rGrime = n("ShaderNodeMath", 80, -300, operation='ADD')
    L(rVar.outputs[0], rGrime.inputs[0])
    gAdd = n("ShaderNodeMath", 80, -380, operation='MULTIPLY'); gAdd.inputs[1].default_value = 0.18
    L(grimeMul.outputs[0], gAdd.inputs[0]); L(gAdd.outputs[0], rGrime.inputs[1])
    rClamp = n("ShaderNodeMath", 220, -320, operation='MINIMUM'); rClamp.inputs[1].default_value = 1.0
    L(rGrime.outputs[0], rClamp.inputs[0])
    rClamp2 = n("ShaderNodeMath", 300, -320, operation='MAXIMUM'); rClamp2.inputs[1].default_value = 0.05
    L(rClamp.outputs[0], rClamp2.inputs[0]); L(rClamp2.outputs[0], outp.inputs["Roughness"])
    # height: 0.5 base - grooves + plate step + micro noise
    hGroove = n("ShaderNodeMath", 0, -520, operation='MULTIPLY'); hGroove.inputs[1].default_value = -0.25
    L(ramp.outputs["Color"], hGroove.inputs[0])
    hPlate = n("ShaderNodeMath", 0, -600, operation='MULTIPLY'); hPlate.inputs[1].default_value = 0.06
    L(bw.outputs["Val"], hPlate.inputs[0])
    hMicro = n("ShaderNodeMath", 0, -680, operation='MULTIPLY'); hMicro.inputs[1].default_value = 0.07
    L(nzF.outputs["Fac"], hMicro.inputs[0])
    hSum = n("ShaderNodeMath", 200, -560, operation='ADD')
    L(hGroove.outputs[0], hSum.inputs[0]); L(hPlate.outputs[0], hSum.inputs[1])
    hSum2 = n("ShaderNodeMath", 300, -560, operation='ADD')
    L(hSum.outputs[0], hSum2.inputs[0]); L(hMicro.outputs[0], hSum2.inputs[1])
    hBase = n("ShaderNodeMath", 380, -560, operation='ADD'); hBase.inputs[1].default_value = 0.5
    L(hSum2.outputs[0], hBase.inputs[0])
    L(hBase.outputs[0], outp.inputs["Height"])
    L(inp.outputs["Metallic"], outp.inputs["MetallicOut"])
    return g

def build_surface_material(name, baseA, baseB, plate=6.0, metallic=0.4, rough=0.7,
                           roughvar=0.25, grime=0.5, bump_strength=0.6, bump_distance=0.35):
    m = bpy.data.materials.get(name)
    if m:
        return m
    g = _new_group()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (200, 0)
    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.location = (-400, 0); tc.name = "TC"
    grp = nt.nodes.new("ShaderNodeGroup"); grp.location = (-100, 0); grp.name = "GRP"
    grp.node_tree = g
    bump = nt.nodes.new("ShaderNodeBump"); bump.location = (60, -260); bump.name = "BUMP"
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = bump_distance
    L = nt.links.new
    L(tc.outputs["Object"], grp.inputs["Vector"])
    grp.inputs["BaseA"].default_value = (*baseA, 1.0)
    grp.inputs["BaseB"].default_value = (*baseB, 1.0)
    grp.inputs["PlateScale"].default_value = plate
    grp.inputs["Metallic"].default_value = metallic
    grp.inputs["RoughBase"].default_value = rough
    grp.inputs["RoughVar"].default_value = roughvar
    grp.inputs["GrimeAmt"].default_value = grime
    L(grp.outputs["Color"], bsdf.inputs["Base Color"])
    L(grp.outputs["Roughness"], bsdf.inputs["Roughness"])
    L(grp.outputs["MetallicOut"], bsdf.inputs["Metallic"])
    L(grp.outputs["Height"], bump.inputs["Height"])
    L(bump.outputs["Normal"], bsdf.inputs["Normal"])
    L(bsdf.outputs["BSDF"], out.inputs["Surface"])
    m["p2_surface"] = True
    return m

def build_p2_materials():
    """Create (or fetch) the full P2 procedural library."""
    mats = {}
    mats['basalt']   = build_surface_material("P2_basalt_plate", (0.150, 0.160, 0.188), (0.190, 0.200, 0.232),
                                              plate=10.0, metallic=0.35, rough=0.82, roughvar=0.22, grime=0.55)
    mats['basalt_light'] = build_surface_material("P2_basalt_light", (0.245, 0.260, 0.293), (0.285, 0.300, 0.333),
                                              plate=7.0, metallic=0.30, rough=0.78, roughvar=0.22, grime=0.45)
    mats['gunmetal'] = build_surface_material("P2_gunmetal", (0.215, 0.230, 0.260), (0.255, 0.270, 0.300),
                                              plate=6.5, metallic=0.80, rough=0.48, roughvar=0.30, grime=0.40)
    mats['gunmetal_dark'] = build_surface_material("P2_gunmetal_dark", (0.085, 0.092, 0.105), (0.108, 0.117, 0.132),
                                              plate=6.0, metallic=0.72, rough=0.56, roughvar=0.28, grime=0.45)
    mats['hull']      = build_surface_material("P2_hull_pale", (0.355, 0.373, 0.392), (0.402, 0.420, 0.438),
                                              plate=4.5, metallic=0.50, rough=0.42, roughvar=0.26, grime=0.35)
    mats['deck']      = build_surface_material("P2_deck_plate", (0.128, 0.138, 0.157), (0.155, 0.165, 0.185),
                                              plate=4.5, metallic=0.55, rough=0.60, roughvar=0.30, grime=0.60)
    mats['wall']      = build_surface_material("P2_interior_wall", (0.305, 0.290, 0.260), (0.345, 0.330, 0.297),
                                              plate=7.0, metallic=0.15, rough=0.72, roughvar=0.20, grime=0.30)
    mats['wood']      = build_surface_material("P2_wood_warm", (0.30, 0.185, 0.095), (0.20, 0.12, 0.06),
                                              plate=2.2, metallic=0.0, rough=0.80, roughvar=0.20, grime=0.25)
    mats['seam']      = build_surface_material("P2_seam_old", (0.095, 0.085, 0.068), (0.118, 0.105, 0.085),
                                              plate=3.0, metallic=0.40, rough=0.95, roughvar=0.15, grime=0.70)
    mats['paper']     = build_surface_material("P2_paper_pale", (0.545, 0.495, 0.405), (0.515, 0.465, 0.375),
                                              plate=1.8, metallic=0.0, rough=0.92, roughvar=0.10, grime=0.30)
    mats['marking']   = build_surface_material("P2_marking_pale", (0.505, 0.487, 0.427), (0.475, 0.455, 0.40),
                                              plate=2.4, metallic=0.05, rough=0.85, roughvar=0.15, grime=0.5)
    return mats

MAT_MAP = {  # pass-1 flat material name -> P2 key
    'MAT_basalt': 'basalt', 'MAT_basalt_light': 'basalt_light', 'MAT_gunmetal': 'gunmetal',
    'MAT_gunmetal_dark': 'gunmetal_dark', 'MAT_hull_pale': 'hull', 'MAT_interior_floor': 'deck',
    'MAT_interior_wall': 'wall', 'MAT_wood_warm': 'wood', 'MAT_seam_old': 'seam',
    'MAT_paper_pale': 'paper',
}

def remap_materials(scene):
    """Replace flat pass-1 materials with P2 procedural ones, slot by slot."""
    mats = build_p2_materials()
    n = 0
    for o in scene.objects:
        if o.type != 'MESH':
            continue
        for s in o.material_slots:
            if s.material and s.material.name in MAT_MAP:
                s.material = mats[MAT_MAP[s.material.name]]
                n += 1
    return n

# ---------------------------------------------------------------- merge / uv
def merge_objects(objects, new_name, anchor_name):
    """Apply modifiers, join meshes into one object parented to anchor_name."""
    objs = [o for o in objects if o and o.type == 'MESH']
    if not objs:
        return None
    if len(objs) == 1:
        o = objs[0]
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        for mod in list(o.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except Exception:
                pass
        o.select_set(False)
        o.name = new_name
        put(o, anchor_name)
        return o
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    # apply modifiers per object first
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for mod in list(o.modifiers):
            try:
                bpy.ops.object.modifier_apply(modifier=mod.name)
            except Exception:
                pass
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active
    merged.name = new_name
    put(merged, anchor_name)
    return merged

def smart_uv(obj, margin=0.004):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.05, island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)

# ---------------------------------------------------------------- baking
def _img(name, w, h, colorspace='Non-Color', float_buf=False, file_format='PNG'):
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=float_buf)
    img.colorspace_settings.name = colorspace
    img.file_format = file_format
    return img

def _set_bake_target(materials, img):
    nodes = []
    for m in materials:
        if not m or not m.use_nodes:
            continue
        nd = m.node_tree.nodes.get("BAKE_TARGET")
        if nd is None:
            nd = m.node_tree.nodes.new("ShaderNodeTexImage")
            nd.name = "BAKE_TARGET"
            nd.location = (600, 400)
        nd.image = img
        m.node_tree.nodes.active = nd
        nodes.append((m, nd))
    return nodes

def _clear_bake_targets(nodes):
    for m, nd in nodes:
        if nd.name in m.node_tree.nodes:
            m.node_tree.nodes.remove(nd)

def _height_variant(mat):
    """Temp material: same surface group, HEIGHT -> Emission (for height bake)."""
    src = mat.node_tree.nodes.get("GRP")
    if src is None:
        return None
    name = mat.name + "_HGT"
    old = bpy.data.materials.get(name)
    if old:
        bpy.data.materials.remove(old)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.name = "TC"
    grp = nt.nodes.new("ShaderNodeGroup"); grp.name = "GRP"; grp.node_tree = src.node_tree
    for inp in src.inputs:
        try:
            grp.inputs[inp.name].default_value = inp.default_value
        except Exception:
            pass
    nt.links.new(tc.outputs["Object"], grp.inputs["Vector"])
    nt.links.new(grp.outputs["Height"], em.inputs["Color"])
    em.inputs["Strength"].default_value = 1.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m

def _sobel_normal(height_img, out_name, strength=2.2):
    w, h = height_img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    height_img.pixels.foreach_get(px)
    hv = px[::4].reshape(h, w)
    gx = (np.roll(hv, -1, 1) - np.roll(hv, 1, 1))
    gy = (np.roll(hv, -1, 0) - np.roll(hv, 1, 0))
    # soften with a second blur pass to avoid texel-noise relief
    gx = (gx + np.roll(gx, 1, 0) + np.roll(gx, -1, 0)) / 3.0
    gy = (gy + np.roll(gy, 1, 1) + np.roll(gy, -1, 1)) / 3.0
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(hv)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.empty(w * h * 4, dtype=np.float32)
    out[0::4] = (nx * inv * 0.5 + 0.5).ravel()
    out[1::4] = (ny * inv * 0.5 + 0.5).ravel()
    out[2::4] = (nz * inv * 0.5 + 0.5).ravel()
    out[3::4] = 1.0
    img = _img(out_name, w, h, 'Non-Color')
    img.pixels.foreach_set(out)
    img.update()
    return img

def _multiply_ao(diff_img, ao_img):
    w, h = diff_img.size
    d = np.empty(w * h * 4, dtype=np.float32); diff_img.pixels.foreach_get(d)
    a = np.empty(w * h * 4, dtype=np.float32); ao_img.pixels.foreach_get(a)
    ao = np.clip(a[::4], 0.0, 1.0) ** 0.9
    lin = np.clip(d.copy(), 0.0, 1.0)
    lin = np.where(lin <= 0.04045, lin / 12.92, ((lin + 0.055) / 1.055) ** 2.4)
    for c in range(3):
        lin[c::4] *= ao
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
    d[0::4], d[1::4], d[2::4] = srgb[0::4], srgb[1::4], srgb[2::4]
    diff_img.pixels.foreach_set(d)
    diff_img.update()

def bake_group(objects, new_name, anchor_name, res=512, emissive_map=False, use_ao=True):
    """Merge objects, smart-UV, bake diffuse(+AO)/roughness/height->normal
    (+optional emission), build the shipped baked material. Returns stats dict."""
    merged = merge_objects(objects, new_name, anchor_name)
    if merged is None:
        return None
    smart_uv(merged)
    mats = [s.material for s in merged.material_slots if s.material]
    tag = new_name
    diff = _img(f"TEX_{tag}_diff", res, res, 'sRGB')
    rough = _img(f"TEX_{tag}_rough", res, res, 'Non-Color')
    ao = _img(f"TEX_{tag}_ao", res, res, 'Non-Color') if use_ao else None
    hgt = _img(f"TEX_{tag}_hgt", res, res, 'Non-Color', float_buf=True, file_format='OPEN_EXR')
    sc = bpy.context.scene
    old_engine = sc.render.engine
    sc.render.engine = 'CYCLES'
    sc.cycles.use_denoising = False
    bake = sc.render.bake
    bake.margin = 10
    bake.use_clear = True
    bpy.ops.object.select_all(action='DESELECT')
    merged.select_set(True)
    bpy.context.view_layer.objects.active = merged

    def do_bake(img, btype, mat_override=None, **kw):
        use_mats = mat_override if mat_override is not None else mats
        nodes = _set_bake_target(use_mats, img)
        for k, v in kw.items():
            setattr(bake, k, v)
        sc.cycles.samples = 16 if btype == 'AO' else 1
        bpy.ops.object.bake(type=btype)
        _clear_bake_targets(nodes)

    do_bake(diff, 'DIFFUSE', use_pass_direct=False, use_pass_indirect=False, use_pass_color=True)
    do_bake(rough, 'ROUGHNESS')
    if use_ao:
        do_bake(ao, 'AO')
    # height via temp emission materials
    orig = [s.material for s in merged.material_slots]
    temps = []
    for i, m in enumerate(orig):
        hv = _height_variant(m) if m else None
        temps.append(hv)
        if hv:
            merged.material_slots[i].material = hv
    do_bake(hgt, 'EMIT', mat_override=[s.material for s in merged.material_slots if s.material])
    for i, m in enumerate(orig):
        merged.material_slots[i].material = m
    for t in temps:
        if t:
            bpy.data.materials.remove(t)
    emit_img = None
    if emissive_map:
        emit_img = _img(f"TEX_{tag}_emit", res, res, 'sRGB')
        do_bake(emit_img, 'EMIT')
    sc.render.engine = old_engine
    if use_ao:
        _multiply_ao(diff, ao)
    nrm = _sobel_normal(hgt, f"TEX_{tag}_nrm")
    for img, fn in ((diff, f"{tag}_diff.png"), (rough, f"{tag}_rough.png"), (nrm, f"{tag}_nrm.png")):
        img.filepath_raw = os.path.join(TEX_DIR, fn)
        img.save()
        img.pack()
    if emit_img:
        emit_img.filepath_raw = os.path.join(TEX_DIR, f"{tag}_emit.png")
        emit_img.save(); emit_img.pack()
    # shipped material
    bname = "BAKED_" + tag
    old = bpy.data.materials.get(bname)
    if old:
        bpy.data.materials.remove(old)
    bm = bpy.data.materials.new(bname)
    bm.use_nodes = True
    nt = bm.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    def tex(img, x, y, label):
        nd = nt.nodes.new("ShaderNodeTexImage"); nd.image = img
        nd.location = (x, y); nd.label = label
        return nd
    td = tex(diff, -500, 200, "diffuse(+AO)")
    nt.links.new(td.outputs["Color"], bsdf.inputs["Base Color"])
    tr = tex(rough, -500, -60, "roughness")
    nt.links.new(tr.outputs["Color"], bsdf.inputs["Roughness"])
    tn = tex(nrm, -500, -320, "normal")
    nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.location = (-220, -320)
    nmap.inputs["Strength"].default_value = 0.9
    nt.links.new(tn.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Metallic"].default_value = 0.35
    if emit_img:
        te = tex(emit_img, -500, 460, "emission")
        nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    merged.data.materials.clear()
    merged.data.materials.append(bm)
    tris = sum(len(p.vertices) - 2 for p in merged.data.polygons)
    info = {"name": new_name, "anchor": anchor_name, "res": res, "tris": tris,
            "material": bname, "emissive_map": bool(emit_img)}
    report(f"BAKED {new_name}: {tris} tris @ {res}px -> {bname}")
    return info

def set_scene(scene):
    """Window-free active-scene switch (MCP exec context has context.window=None)."""
    for w in bpy.context.window_manager.windows:
        w.scene = scene

def draw_estimate(scene):
    combos = set(); raw = 0
    for o in scene.objects:
        if o.type == 'MESH':
            raw += 1
            mats = tuple(s.material.name if s.material else '' for s in o.material_slots)
            combos.add((o.data.name, mats))
    return raw, len(combos)

def holder_meshes(holder_name):
    h = bpy.data.objects.get(holder_name)
    if h is None:
        return []
    return [o for o in h.children_recursive if o.type == 'MESH']

def by_material(objects, mat_names):
    return [o for o in objects if any(s.material and s.material.name in mat_names for s in o.material_slots)]

EMISSIVE_MATS = {'MAT_amber_emit', 'MAT_amber_emit_soft', 'MAT_cyan_emit'}
FLAT_KEEP = {'MAT_amber_emit', 'MAT_amber_emit_soft', 'MAT_cyan_emit', 'MAT_glass',
             'MAT_planet_lava', 'MAT_planet_q1', 'MAT_stardome', 'MAT_dark_unlit'}
