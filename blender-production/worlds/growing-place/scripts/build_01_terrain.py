# Growing Place — build_01: terraces, risers, underside, paths, lit paths.
import sys, math
sys.path.append("/home/hatch/workspace/Soumaya-Environment-Production/worlds/growing-place/scripts")
import bpy
import gp_lib as G
from gp_layout import GROVES, PATH_R, RAMP_AZ

G.load_registry()
sc = G.get_scene()
RADII, HEIGHTS = G.RADII, G.HEIGHTS

def angdiff(a, b):
    return abs((a - b + math.pi) % (2 * math.pi) - math.pi)

def make_z(t):
    H = HEIGHTS[t]
    pr = PATH_R[t]
    r_in = RADII[t + 1] if t < 5 else 8.0
    r_out = RADII[t]
    groves_t = [(g["x"], g["y"]) for g in GROVES if g["t"] == t]
    def z(r, th):
        amp = 2.1
        d = abs(r - pr)
        amp *= min(1.0, max(0.0, (d - 9.0) / 16.0))
        x, y = r * math.cos(th), r * math.sin(th)
        for gx, gy in groves_t:
            dist = math.hypot(x - gx, y - gy)
            amp *= min(1.0, max(0.0, (dist - 58.0) / 14.0))
        for rt in (t - 1, t):
            if 0 <= rt < 5:
                da = angdiff(th, RAMP_AZ[rt])
                amp *= min(1.0, max(0.0, (da - 0.045) / 0.05))
        if t == 5:
            amp *= min(1.0, r / 70.0)
        v = H + G.pnoise(th, r, seed=t * 3.7) * amp
        fr = (r - r_in) / max(1.0, (r_out - r_in))
        if fr > 0.90:
            v -= (fr - 0.90) * 8.0
        if fr < 0.08:
            v -= (0.08 - fr) * 4.0
        return v
    return z

# ---- terrace tops
for t in range(6):
    r_in = RADII[t + 1] if t < 5 else 8.0
    g = G.Geo()
    g.annulus(r_in, RADII[t], make_z(t), seg=180, rings=5, uv_scale=1.0/220.0)
    mat = bpy.data.materials["GP_lawn_t%d" % t]
    ob = g.to_object("terrace_t%d_top" % t, G.clear_holder(sc, "terrace-%d" % t), mat)
    G.register_obj("lawn_t%d" % t, ob.name)

# ---- risers
for t in range(1, 6):
    g = G.Geo()
    def wob(th, fr, t=t):
        return 1.3 * math.sin(9.0 * th + fr * 5.0) + 0.8 * G.pnoise(th, 40.0 * fr, seed=t * 1.3)
    g.wall(RADII[t] + 0.5, HEIGHTS[t] - 0.2, RADII[t] + 7.0, HEIGHTS[t - 1] - 2.0,
           seg=180, vsteps=4, u_rep=40.0, wobble=wob)
    mat = bpy.data.materials["GP_stone_r%d" % t]
    ob = g.to_object("terrace_riser%d" % t, G.clear_holder(sc, "terrace-riser-%d" % t), mat)
    G.register_obj("stone_r%d" % t, ob.name)
# riser 0 = outer face of the base terrace
g = G.Geo()
g.wall(901.0, -0.2, 908.0, -18.0, seg=180, vsteps=2, u_rep=40.0,
       wobble=lambda th, fr: 1.2 * math.sin(9.0 * th + fr * 4.0))
ob = g.to_object("terrace_riser0", G.clear_holder(sc, "terrace-riser-0"),
                 bpy.data.materials["GP_stone_r0"])
G.register_obj("stone_r0", ob.name)

# ---- underside: skirt + cap
g = G.Geo()
g.wall(908.0, -18.0, 615.0, -60.0, seg=144, vsteps=3, u_rep=40.0,
       wobble=lambda th, fr: 3.0 * G.pnoise(th, 30.0 * fr, seed=9.1))
ob = g.to_object("underside_skirt", G.clear_holder(sc, "garden-underside-skirt"),
                 bpy.data.materials["GP_stone_under"])
G.register_obj("stone_under", ob.name)
g = G.Geo()
g.disc(615.0, -60.0, seg=120, flip=True)
ob = g.to_object("underside_cap", G.clear_holder(sc, "garden-underside-cap"),
                 bpy.data.materials["GP_stone_under"])
G.register_obj("stone_under", ob.name)

# ---- paths: ring ribbons + ramp steps (one earth mesh) + stone edging
gp = G.Geo()
ge = G.Geo()
gl_ = G.Geo()
for t in range(6):
    H = HEIGHTS[t]
    pr = PATH_R[t]
    gp.annulus(pr - 7.0, pr + 7.0, lambda r, th, H=H: H + 0.18, seg=180, rings=1, uv_scale=1.0/160.0)
    gl_.annulus(pr - 7.9, pr - 7.0, lambda r, th, H=H: H + 0.30, seg=180, rings=1)
    gl_.annulus(pr + 7.0, pr + 7.9, lambda r, th, H=H: H + 0.30, seg=180, rings=1)
    # edging stones along the ring path
    circ = 2 * math.pi * pr
    n = int(circ / 26.0)
    for i in range(n):
        az = 2 * math.pi * i / n
        for sgn in (-1, 1):
            rr = pr + sgn * 8.6
            j = G.hash01(i * 7.3 + t * 91.7 + sgn)
            ge.box((rr * math.cos(az), rr * math.sin(az), H + 0.35),
                   (1.2 + j * 0.5, 1.0 + j * 0.4, 0.8), rotz=az + (j - 0.5) * 0.4)
# ramps: broad steps climbing each riser, plus edging + lit strips
for t in range(5):
    phi = RAMP_AZ[t]
    cu, su = math.cos(phi), math.sin(phi)
    r_start = RADII[t + 1] + 66.0
    r_end = RADII[t + 1] - 58.0
    nsteps = 6
    for i in range(nsteps):
        fr1 = (i + 1) / nsteps
        r_c = r_start + (r_end - r_start) * (i + 0.5) / nsteps
        z_top = HEIGHTS[t] + (HEIGHTS[t + 1] - HEIGHTS[t]) * fr1 + 0.18
        gp.box((r_c * cu, r_c * su, z_top - 1.2),
               ((r_start - r_end) / nsteps + 2.5, 13.0, 2.4), rotz=phi)
        for sgn in (-1, 1):
            off = 7.3 * sgn
            px, py = r_c * cu - su * off, r_c * su + cu * off
            ge.box((px, py, z_top + 0.1), (3.2, 1.1, 0.9), rotz=phi)
            gl_.box((r_c * cu - su * (6.8 * sgn), r_c * su + cu * (6.8 * sgn), z_top + 0.28),
                    ((r_start - r_end) / nsteps + 2.0, 0.9, 0.45), rotz=phi)
ob = gp.to_object("paths_earth", G.clear_holder(sc, "paths"), bpy.data.materials["GP_path"])
G.register_obj("path", ob.name)
ob = ge.to_object("paths_edging", G.holder(sc, "paths"), bpy.data.materials["GP_stone_edge"])
G.register_obj("stone_edge", ob.name)
ob = gl_.to_object("lit_paths", G.clear_holder(sc, "lit-paths"), bpy.data.materials["GP_gold_emit"], smooth=False)
print("terrain+paths done")
G.save_registry()
bpy.ops.wm.save_mainfile()
print("SAVED")
