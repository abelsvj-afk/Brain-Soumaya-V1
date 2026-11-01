# Growing Place — shared build library.
# Deterministic geometry kernel + GP_SURFACE material system + bake registry.
import bpy, math, json, os, random
from mathutils import Vector, Matrix

BASE = "/home/hatch/workspace/Soumaya-Environment-Production"
SCRIPTS = os.path.join(BASE, "worlds/growing-place/scripts")
TEXDIR = os.path.join(BASE, "worlds/growing-place/tex")
SCENE_NAME = "GROWING_PLACE"
ROOT_NAME = "growing-place"

RADII = [900.0, 780.0, 660.0, 540.0, 400.0, 250.0]
HEIGHTS = [0.0, 18.0, 36.0, 54.0, 72.0, 90.0]
UNDER = 60.0  # underside depth

BAKE_REGISTRY = {}  # group_key -> {material, size, objects:[names]}

# ---------------------------------------------------------------- scene utils
def get_scene():
    sc = bpy.data.scenes.get(SCENE_NAME)
    if sc is None:
        sc = bpy.data.scenes.new(SCENE_NAME)
    bpy.context.window.scene = sc
    return sc

def get_root(sc):
    root = sc.collection.children.get(ROOT_NAME)
    if root is None:
        root = bpy.data.collections.new(ROOT_NAME)
        sc.collection.children.link(root)
    return root

def holder(sc, name):
    root = get_root(sc)
    h = root.children.get(name)
    if h is None:
        h = bpy.data.collections.new(name)
        root.children.link(h)
    return h

def clear_holder(sc, name):
    h = holder(sc, name)
    for ob in list(h.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    return h

# ---------------------------------------------------------------- noise
def pnoise(theta, r, seed=0.0):
    """Smooth periodic-in-theta undulation, returns roughly [-1, 1]."""
    v = (0.50 * math.sin(3.0 * theta + seed)
         + 0.30 * math.sin(7.0 * theta + 1.7 + seed * 2.0)
         + 0.42 * math.sin(2.0 * theta - 0.6 + seed)
         + 0.25 * math.sin(r * 0.045 + seed * 3.0)
         + 0.18 * math.sin(11.0 * theta + r * 0.02 - seed))
    return v / 1.65

def hash01(n):
    x = math.sin(n * 127.1 + 311.7) * 43758.5453
    return x - math.floor(x)

# ---------------------------------------------------------------- geometry kernel
class Geo:
    def __init__(self):
        self.verts = []
        self.faces = []   # list of tuples of vert indices
        self.uvs = []     # parallel to faces: list of (u,v) per corner

    def _v(self, p):
        self.verts.append(p)
        return len(self.verts) - 1

    def quad(self, a, b, c, d, uvs=None):
        idx = [self._v(a), self._v(b), self._v(c), self._v(d)]
        self.faces.append(tuple(idx))
        self.uvs.append(uvs or [(0, 0), (1, 0), (1, 1), (0, 1)])

    def tri(self, a, b, c, uvs=None):
        idx = [self._v(a), self._v(b), self._v(c)]
        self.faces.append(tuple(idx))
        self.uvs.append(uvs or [(0, 0), (1, 0), (0.5, 1)])

    def annulus(self, r_in, r_out, z_fn, seg=160, rings=4, uv_scale=1.0 / 1800.0, phase=0.0):
        """Horizontal annulus; z_fn(r, theta) -> z. Planar UVs."""
        grid = []
        for j in range(rings + 1):
            fr = j / rings
            r = r_in + (r_out - r_in) * fr
            row = []
            for i in range(seg):
                th = phase + 2 * math.pi * i / seg
                x, y = r * math.cos(th), r * math.sin(th)
                row.append(self._v((x, y, z_fn(r, th))))
            grid.append(row)
        for j in range(rings):
            for i in range(seg):
                i2 = (i + 1) % seg
                a, b = grid[j][i], grid[j][i2]
                c, d = grid[j + 1][i2], grid[j + 1][i]
                pa, pb = self.verts[a], self.verts[b]
                pc, pd = self.verts[c], self.verts[d]
                uv = [(pa[0] * uv_scale + .5, pa[1] * uv_scale + .5),
                      (pb[0] * uv_scale + .5, pb[1] * uv_scale + .5),
                      (pc[0] * uv_scale + .5, pc[1] * uv_scale + .5),
                      (pd[0] * uv_scale + .5, pd[1] * uv_scale + .5)]
                # Winding (a, d, c, b): radial x tangent = +z (UP).
                # The original (a, b, c, d) order faced DOWN — found in
                # Stage E when every terrace lawn baked black.
                self.faces.append((a, d, c, b))
                self.uvs.append([uv[0], uv[3], uv[2], uv[1]])

    def wall(self, r_top, z_top, r_bot, z_bot, seg=160, vsteps=3, u_rep=24.0,
             wobble=None, phase=0.0):
        """Cylindrical-ish wall from (r_top,z_top) down to (r_bot,z_bot)."""
        grid = []
        for j in range(vsteps + 1):
            fr = j / vsteps
            r = r_top + (r_bot - r_top) * fr
            z = z_top + (z_bot - z_top) * fr
            row = []
            for i in range(seg):
                th = phase + 2 * math.pi * i / seg
                rr = r + (wobble(th, fr) if wobble else 0.0)
                row.append(self._v((rr * math.cos(th), rr * math.sin(th), z)))
            grid.append(row)
        for j in range(vsteps):
            for i in range(seg):
                i2 = (i + 1) % seg
                a, b = grid[j][i], grid[j][i2]
                c, d = grid[j + 1][i2], grid[j + 1][i]
                ua, ub = (i / seg) * u_rep, ((i + 1) / seg) * u_rep
                va, vb = 1.0 - j / vsteps, 1.0 - (j + 1) / vsteps
                # Winding (a, d, c, b): down x tangent = radially OUT.
                # The original (a, b, c, d) order faced the axis (Stage E).
                self.faces.append((a, d, c, b))
                self.uvs.append([(ua, va), (ua, vb), (ub, vb), (ub, va)])

    def disc(self, r, z, seg=96, uv_scale=1.0 / 1800.0, flip=False):
        # Default winding faces UP (+z). flip=True ONLY for discs that must
        # face DOWN (e.g. the island underside cap) — lawns/discs placed on
        # terraces must use flip=False (Stage E: flipped lawns baked black).
        c = self._v((0, 0, z))
        ring = [self._v((r * math.cos(2 * math.pi * i / seg),
                         r * math.sin(2 * math.pi * i / seg), z)) for i in range(seg)]
        for i in range(seg):
            i2 = (i + 1) % seg
            pa, pb = self.verts[ring[i]], self.verts[ring[i2]]
            f = (c, ring[i2], ring[i]) if flip else (c, ring[i], ring[i2])
            self.faces.append(f)
            self.uvs.append([(.5, .5),
                             (pa[0] * uv_scale + .5, pa[1] * uv_scale + .5),
                             (pb[0] * uv_scale + .5, pb[1] * uv_scale + .5)])

    def tube(self, p0, p1, r0, r1, sides=8, u_rep=1.0, v_len=1.0):
        """Tapered tube segment between two points."""
        d = Vector(p1) - Vector(p0)
        if d.length < 1e-6:
            return
        quat = d.to_track_quat('Z', 'Y')
        ring = []
        for p, r in ((p0, r0), (p1, r1)):
            row = []
            for i in range(sides):
                a = 2 * math.pi * i / sides
                off = quat @ Vector((r * math.cos(a), r * math.sin(a), 0))
                row.append(self._v(tuple(Vector(p) + off)))
            ring.append(row)
        for i in range(sides):
            i2 = (i + 1) % sides
            a, b, c, dd = ring[0][i], ring[0][i2], ring[1][i2], ring[1][i]
            ua, ub = (i / sides) * u_rep, ((i + 1) / sides) * u_rep
            self.faces.append((a, b, c, dd))
            self.uvs.append([(ua, 0), (ub, 0), (ub, v_len), (ua, v_len)])

    def limb(self, points, r0, r1, sides=8):
        n = len(points) - 1
        for i in range(n):
            fr0, fr1 = i / n, (i + 1) / n
            self.tube(points[i], points[i + 1],
                      r0 + (r1 - r0) * fr0, r0 + (r1 - r0) * fr1,
                      sides=sides, u_rep=3.0, v_len=1.0)

    def box(self, center, size, rotz=0.0, uvs=0.25):
        cx, cy, cz = center
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        cr, sr = math.cos(rotz), math.sin(rotz)
        cor = []
        for dx, dy, dz in [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                           (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]:
            cor.append((cx + dx * sx * cr - dy * sy * sr,
                        cy + dx * sx * sr + dy * sy * cr, cz + dz * sz))
        F = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        base = len(self.verts)
        for p in cor:
            self._v(p)
        for f in F:
            self.faces.append(tuple(base + i for i in f))
            self.uvs.append([(0, 0), (uvs, 0), (uvs, uvs), (0, uvs)])

    def blob(self, center, r, subdv=2, disp=0.22, seed=0.0, squash=0.82):
        """Displaced icosphere. Returns nothing; appends to this Geo."""
        t = (1.0 + math.sqrt(5.0)) / 2.0
        V = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0),
             (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t),
             (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
        V = [Vector(v).normalized() for v in V]
        F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
             (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
             (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
             (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
        cache = {}
        def mid(a, b):
            key = (min(a, b), max(a, b))
            if key in cache:
                return cache[key]
            m = ((V[a] + V[b]) / 2).normalized()
            V.append(m)
            cache[key] = len(V) - 1
            return cache[key]
        for _ in range(subdv):
            NF = []
            for a, b, c in F:
                ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
                NF += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
            F = NF
        base = len(self.verts)
        for v in V:
            n = (0.55 * math.sin(v.x * 5.1 + seed) * math.sin(v.y * 4.3 + seed * 2.0)
                 + 0.45 * math.sin(v.z * 6.2 - seed) * math.sin(v.x * 3.7 + seed))
            rr = r * (1.0 + disp * n)
            p = (center[0] + v.x * rr, center[1] + v.y * rr,
                 center[2] + v.z * rr * squash)
            self._v(p)
        for a, b, c in F:
            pa, pb, pc = V[a], V[b], V[c]
            self.faces.append((base + a, base + b, base + c))
            self.uvs.append([(pa.x * .5 + .5, pa.y * .5 + .5),
                             (pb.x * .5 + .5, pb.y * .5 + .5),
                             (pc.x * .5 + .5, pc.y * .5 + .5)])

    def lathe(self, profile, seg=20, phase=0.0):
        """profile: list of (radius, z, u_rep_v). Rotates around Z at origin."""
        grid = []
        for (r, z, v) in profile:
            row = []
            for i in range(seg):
                th = phase + 2 * math.pi * i / seg
                row.append(self._v((r * math.cos(th), r * math.sin(th), z)))
            grid.append(row)
        for j in range(len(profile) - 1):
            for i in range(seg):
                i2 = (i + 1) % seg
                a, b = grid[j][i], grid[j][i2]
                c, d = grid[j + 1][i2], grid[j + 1][i]
                self.faces.append((a, b, c, d))
                self.uvs.append([(i / seg * 4, profile[j][2]),
                                 ((i + 1) / seg * 4, profile[j][2]),
                                 ((i + 1) / seg * 4, profile[j + 1][2]),
                                 (i / seg * 4, profile[j + 1][2])])

    def merge(self, other, matrix=None):
        """Append another Geo (optionally transformed by a 4x4 Matrix)."""
        base = len(self.verts)
        if matrix is not None:
            for p in other.verts:
                self._v(tuple(matrix @ Vector(p)))
        else:
            for p in other.verts:
                self._v(p)
        for f in other.faces:
            self.faces.append(tuple(base + i for i in f))
        self.uvs.extend(other.uvs)

    def to_object(self, name, collection, material=None, smooth=True):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.verts, [], self.faces)
        me.update()
        uv = me.uv_layers.new(name="UVMap")
        lf = 0
        for poly in me.polygons:
            for li in range(poly.loop_start, poly.loop_start + poly.loop_total):
                uv.data[li].uv = self.uvs[lf][li - poly.loop_start]
            lf += 1
        if material is not None:
            me.materials.append(material)
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        if smooth:
            for p in me.polygons:
                p.use_smooth = True
        return ob

# ---------------------------------------------------------------- materials
def surface_group():
    g = bpy.data.node_groups.get("GP_SURFACE")
    if g is not None:
        return g
    g = bpy.data.node_groups.new("GP_SURFACE", 'ShaderNodeTree')
    g.interface.new_socket("Color", in_out='OUTPUT', socket_type='NodeSocketColor')
    g.interface.new_socket("Roughness", in_out='OUTPUT', socket_type='NodeSocketFloat')
    for nm, tp in [("BaseA", 'NodeSocketColor'), ("BaseB", 'NodeSocketColor'),
                   ("Moss", 'NodeSocketColor'), ("PatchScale", 'NodeSocketFloat'),
                   ("GrainScale", 'NodeSocketFloat'), ("MossAmt", 'NodeSocketFloat'),
                   ("RoughLo", 'NodeSocketFloat'), ("RoughHi", 'NodeSocketFloat')]:
        g.interface.new_socket(nm, in_out='INPUT', socket_type=tp)
    nd = {}
    def N(t, x, y, **kw):
        n = g.nodes.new(t)
        n.location = (x, y)
        for k, v in kw.items():
            setattr(n, k, v)
        nd[n.name] = n
        return n
    gin = N('NodeGroupInput', -900, 0)
    gout = N('NodeGroupOutput', 700, 0)
    tex = N('ShaderNodeTexCoord', -900, 350)
    patch = N('ShaderNodeTexNoise', -650, 300)
    patch.noise_dimensions = '3D'
    grain = N('ShaderNodeTexNoise', -650, 0)
    grain.noise_dimensions = '3D'
    vor = N('ShaderNodeTexVoronoi', -650, -300)
    vor.feature = 'DISTANCE_TO_EDGE'
    mscale = N('ShaderNodeMapping', -780, 480)
    # Sample OBJECT coordinates, not UV: kernel UVs are world-tiling UVs,
    # which Cycles cannot bake (tiled UV bakes come out black — proven on
    # the Growing Place lawns, Stage E). Object coords at 1/220 reproduce
    # the tiling pattern scale and leave mesh UVs free to be bake UVs.
    mscale.inputs['Scale'].default_value = (1 / 220.0, 1 / 220.0, 1 / 220.0)
    g.links.new(tex.outputs['Object'], mscale.inputs['Vector'])
    g.links.new(mscale.outputs['Vector'], patch.inputs['Vector'])
    g.links.new(mscale.outputs['Vector'], grain.inputs['Vector'])
    g.links.new(mscale.outputs['Vector'], vor.inputs['Vector'])
    g.links.new(gin.outputs['PatchScale'], patch.inputs['Scale'])
    g.links.new(gin.outputs['GrainScale'], grain.inputs['Scale'])
    g.links.new(gin.outputs['PatchScale'], vor.inputs['Scale'])
    ramp = N('ShaderNodeValToRGB', -420, 300)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.65
    g.links.new(patch.outputs['Fac'], ramp.inputs['Fac'])
    mix = N('ShaderNodeMixRGB', -180, 300, blend_type='MIX')
    g.links.new(ramp.outputs['Color'], mix.inputs['Fac'])
    g.links.new(gin.outputs['BaseA'], mix.inputs[1])
    g.links.new(gin.outputs['BaseB'], mix.inputs[2])
    # moss creep: second noise band mixed in by amount
    mossmix = N('ShaderNodeMixRGB', 60, 300, blend_type='MIX')
    g.links.new(mix.outputs['Color'], mossmix.inputs[1])
    g.links.new(gin.outputs['Moss'], mossmix.inputs[2])
    mmul = N('ShaderNodeMath', -180, 60, operation='MULTIPLY')
    g.links.new(grain.outputs['Fac'], mmul.inputs[0])
    g.links.new(gin.outputs['MossAmt'], mmul.inputs[1])
    clamp = N('ShaderNodeClamp', 60, 60)
    clamp.inputs[1].default_value = 0.0
    clamp.inputs[2].default_value = 0.85
    g.links.new(mmul.outputs['Value'], clamp.inputs[0])
    g.links.new(clamp.outputs['Result'], mossmix.inputs['Fac'])
    # groove darkening from voronoi edges
    gramp = N('ShaderNodeValToRGB', -420, -300)
    gramp.color_ramp.elements[0].position = 0.0
    gramp.color_ramp.elements[0].color = (0.72, 0.72, 0.72, 1)
    gramp.color_ramp.elements[1].position = 0.16
    gramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    g.links.new(vor.outputs['Distance'], gramp.inputs['Fac'])
    gmix = N('ShaderNodeMixRGB', 300, 300, blend_type='MULTIPLY')
    g.links.new(mossmix.outputs['Color'], gmix.inputs[1])
    g.links.new(gramp.outputs['Color'], gmix.inputs[2])
    g.links.new(gmix.outputs['Color'], gout.inputs['Color'])
    rmix = N('ShaderNodeMath', 300, -80, operation='MULTIPLY_ADD')
    g.links.new(grain.outputs['Fac'], rmix.inputs[0])
    g.links.new(rmix.outputs['Value'], gout.inputs['Roughness'])
    # Roughness = RoughLo + grain*(RoughHi-RoughLo): emulate via two maths
    sub = N('ShaderNodeMath', -420, -120, operation='SUBTRACT')
    g.links.new(gin.outputs['RoughHi'], sub.inputs[0])
    g.links.new(gin.outputs['RoughLo'], sub.inputs[1])
    rmul = N('ShaderNodeMath', -180, -120, operation='MULTIPLY')
    g.links.new(grain.outputs['Fac'], rmul.inputs[0])
    g.links.new(sub.outputs['Value'], rmul.inputs[1])
    radd = N('ShaderNodeMath', 60, -120, operation='ADD')
    g.links.new(rmul.outputs['Value'], radd.inputs[0])
    g.links.new(gin.outputs['RoughLo'], radd.inputs[1])
    g.links.new(radd.outputs['Result'] if 'Result' in radd.outputs else radd.outputs['Value'],
                gout.inputs['Roughness'])
    g.links.remove(rmix.outputs['Value'].links[0]) if rmix.outputs['Value'].links else None
    return g

def gp_material(name, colA, colB, moss=(0.16, 0.26, 0.10), patch=5.0, grain=34.0,
                moss_amt=0.35, rough=(0.78, 1.0), metallic=0.0, bake_size=0,
                group_key=None, emission=None, emission_strength=1.0):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (420, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (180, 0)
    bsdf.inputs['Metallic'].default_value = metallic
    grp = nt.nodes.new('ShaderNodeGroup')
    grp.node_tree = surface_group()
    grp.location = (-260, 0)
    grp.inputs['BaseA'].default_value = (*colA, 1.0)
    grp.inputs['BaseB'].default_value = (*colB, 1.0)
    grp.inputs['Moss'].default_value = (*moss, 1.0)
    grp.inputs['PatchScale'].default_value = patch
    grp.inputs['GrainScale'].default_value = grain
    grp.inputs['MossAmt'].default_value = moss_amt
    grp.inputs['RoughLo'].default_value = rough[0]
    grp.inputs['RoughHi'].default_value = rough[1]
    nt.links.new(grp.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(grp.outputs['Roughness'], bsdf.inputs['Roughness'])
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    if group_key:
        BAKE_REGISTRY[group_key] = {"material": name, "size": bake_size, "objects": []}
    return m

def lit_material(name, color, emission=None, strength=1.0, rough=0.9, alpha=None):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1.0)
        bsdf.inputs['Emission Strength'].default_value = strength
    if alpha is not None:
        bsdf.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'DITHERED'
    return m

def register_obj(group_key, obj_name):
    if group_key in BAKE_REGISTRY:
        BAKE_REGISTRY[group_key]["objects"].append(obj_name)

def save_registry():
    path = os.path.join(SCRIPTS, "bake_registry.json")
    old = {}
    if os.path.exists(path):
        old = json.load(open(path))
    old.update(BAKE_REGISTRY)
    json.dump(old, open(path, "w"), indent=1)
    return path

def load_registry():
    path = os.path.join(SCRIPTS, "bake_registry.json")
    if os.path.exists(path):
        BAKE_REGISTRY.update(json.load(open(path)))
    return BAKE_REGISTRY

def radial_sprite_texture(name="GP_radial_sprite", size=256):
    img = bpy.data.images.get(name)
    if img is not None:
        return img
    img = bpy.data.images.new(name, size, size, alpha=True)
    px = []
    for y in range(size):
        for x in range(size):
            dx, dy = (x - size / 2) / (size / 2), (y - size / 2) / (size / 2)
            d = math.sqrt(dx * dx + dy * dy)
            a = max(0.0, 1.0 - d) ** 2
            px += [1.0, 0.85, 0.55, a]
    img.pixels = px
    img.pack()
    return img

def sprite_material(name="GP_halo_sprite"):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = radial_sprite_texture()
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Emission Color'])
    nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
    bsdf.inputs['Emission Strength'].default_value = 1.6
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    m.surface_render_method = 'DITHERED'
    return m

import sys
if SCRIPTS not in sys.path:
    sys.path.append(SCRIPTS)
from gp_layout import GROVES, PATH_R  # noqa: E402
