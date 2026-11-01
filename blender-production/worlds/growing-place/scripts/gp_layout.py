# Growing Place — site layout data (single source for terrain + dressing).
import math

RADII = [900.0, 780.0, 660.0, 540.0, 400.0, 250.0]
HEIGHTS = [0.0, 18.0, 36.0, 54.0, 72.0, 90.0]

# Ring-path radius per terrace (mid-annulus; crown path rings the tree court).
PATH_R = {0: 838.0, 1: 718.0, 2: 598.0, 3: 468.0, 4: 322.0, 5: 168.0}
# Ramp azimuth (terrace t -> t+1) for t = 0..4.
RAMP_AZ = [t * 1.05 for t in range(5)]

def _clear(az, t):
    """Keep sites away from ramp azimuths touching terrace t."""
    for rt in (t - 1, t):
        if 0 <= rt < 5:
            d = abs((az - RAMP_AZ[rt] + math.pi) % (2 * math.pi) - math.pi)
            if d < 0.30:
                return False
    return True

def _far(az, r, t, others, mind):
    x, y = r * math.cos(az), r * math.sin(az)
    for o in others:
        if o["t"] == t and math.hypot(o["x"] - x, o["y"] - y) < mind:
            return False
    return True

GROVES = []  # {t, az, r, x, y, z, variant}
_counts = {0: 4, 1: 4, 2: 3, 3: 3, 4: 3, 5: 3}
_variants = ["A", "B", "C", "A", "C", "B"]
for t in range(6):
    n = _counts[t]
    placed = 0
    k = 0
    while placed < n and k < 200:
        az = (t * 0.83 + placed * (2 * math.pi / n) + k * 0.29) % (2 * math.pi)
        k += 1
        if not _clear(az, t):
            continue
        if t < 5:
            r = PATH_R[t] - 42.0
        else:
            r = 148.0 + 14.0 * (placed % 2)
        if not _far(az, r, t, GROVES, 130):
            continue
        GROVES.append({"t": t, "az": az, "r": r,
                       "x": r * math.cos(az), "y": r * math.sin(az),
                       "z": HEIGHTS[t], "variant": _variants[(t + placed) % 6],
                       "id": len(GROVES)})
        placed += 1

PLOTS = []  # {family, t, az, r, x, y, z}
_fams = ["gathering", "sprout", "stone", "wild", "sprout", "gathering",
         "wild", "stone", "sprout"]
for i, fam in enumerate(_fams):
    t = i % 5
    r = PATH_R[t] - 50.0 if i % 2 == 0 else PATH_R[t] + 24.0
    az = (1.9 + i * 2.21) % (2 * math.pi)
    tries = 0
    while tries < 60:
        if (_clear(az, t) and _far(az, r, t, GROVES, 125)
                and _far(az, r, t, PLOTS, 110)):
            break
        az += 0.31
        tries += 1
    PLOTS.append({"family": fam, "t": t, "az": az, "r": r,
                  "x": r * math.cos(az), "y": r * math.sin(az),
                  "z": HEIGHTS[t], "id": i})
