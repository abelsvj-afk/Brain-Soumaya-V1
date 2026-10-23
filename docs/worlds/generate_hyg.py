#!/usr/bin/env python3
"""Generate the Worlds starfield asset from the HYG database (Astronexus).

Source: https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
License: CC BY-SA 4.0 (HYG database, Astronexus) — the credit ships in-app
(WorldCredits) and in public/CREDITS.md; this subset is an adaptation.

Subset rule: the 5,000 brightest stars by apparent magnitude — exactly what
the in-app credit says ("a subset of the brightest stars is used").
Positions: the file's own equatorial Cartesian columns (x, y, z, parsecs),
normalized to directions and mapped to three.js axes as
(x, z, -y), placed on a shell of radius R (direction is the data; the
shell radius is presentation). Colors: from the B-V color index (ci)
through the standard Planckian approximation below; brightness scaling
by magnitude is presentation, documented here, not data.
"""
import csv, math, struct, base64, hashlib, json

SRC = "hygdata_v41.csv"
OUT = "hygData.ts"
N = 5000
R = 3800.0

def bv_to_rgb(bv: float) -> tuple[float, float, float]:
    # B-V -> approximate temperature (Ballesteros), then temperature ->
    # RGB via the Tanner Helland approximation. Presentation mapping;
    # the credited derivations are the positions and the B-V source.
    bv = max(-0.4, min(2.0, bv))
    temp = 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62))
    tt = temp / 100.0
    if tt <= 66:
        r = 1.0
        g = max(0.0, min(1.0, (99.4708025861 * math.log(max(tt, 1.01)) - 161.1195681661) / 255.0))
    else:
        r = max(0.0, min(1.0, 329.698727446 * ((tt - 60) ** -0.1332047592) / 255.0))
        g = max(0.0, min(1.0, 288.1221695283 * ((tt - 60) ** -0.0755148492) / 255.0))
    if tt >= 66:
        b = 1.0
    elif tt <= 19:
        b = 0.0
    else:
        b = max(0.0, min(1.0, (138.5177312231 * math.log(tt - 10) - 305.0447927307) / 255.0))
    return (r, g, b)

rows = []
total = 0
with open(SRC, newline="", encoding="utf-8") as fh:
    rd = csv.DictReader(fh)
    for row in rd:
        total += 1
        try:
            mag = float(row["mag"])
            x, y, z = float(row["x"]), float(row["y"]), float(row["z"])
        except (TypeError, ValueError):
            continue
        if x == 0.0 and y == 0.0 and z == 0.0:
            continue
        if row.get("proper") == "Sol" or row.get("id") == "0":
            continue  # the Sun is in HYG (mag -26.7); it is not a starfield star
        try:
            ci = float(row["ci"]) if row["ci"] not in (None, "") else 0.65
            ci_missing = row["ci"] in (None, "")
        except ValueError:
            ci, ci_missing = 0.65, True
        rows.append((mag, x, y, z, ci, ci_missing))

rows.sort(key=lambda r: r[0])
sub = rows[:N]
pos = bytearray()
col = bytearray()
ci_missing_n = 0
for mag, x, y, z, ci, ci_missing in sub:
    if ci_missing:
        ci_missing_n += 1
    n = math.sqrt(x * x + y * y + z * z)
    px, py, pz = x / n * R, z / n * R, -y / n * R
    pos += struct.pack("<fff", px, py, pz)
    r, g, b = bv_to_rgb(ci)
    # Presentation brightness from magnitude: brightest ~1.0, cutoff ~0.35.
    inten = max(0.35, min(1.0, 1.12 - 0.11 * (mag + 1.5)))
    col += struct.pack("<fff", r * inten, g * inten, b * inten)

meta = {
    "source_file": "hygdata_v41.csv (HYG database, Astronexus — github.com/astronexus/HYG-Database, hyg/CURRENT/)",
    "source_sha256": hashlib.sha256(open(SRC, "rb").read()).hexdigest(),
    "total_rows": total,
    "subset": f"brightest {N} by apparent magnitude",
    "mag_brightest": sub[0][0],
    "mag_cutoff": sub[-1][0],
    "ci_missing_in_subset": ci_missing_n,
    "shell_radius": R,
}
ts = f"""/**
 * GENERATED FILE — do not hand-edit. Regenerate with
 * gate0/hyg/generate_hyg.py (kept with the worlds design records).
 *
 * Star data: HYG database (Astronexus), CC BY-SA 4.0. Subset: the
 * {N} brightest stars by apparent magnitude. Positions are the
 * database's own equatorial Cartesian values, normalized to directions
 * (three.js axes: x, z, -y) on a presentation shell; colors derive
 * from the B-V color index. Provenance: {meta["source_file"]};
 * source sha256 {meta["source_sha256"][:16]}…, {total} rows,
 * subset magnitude range {meta["mag_brightest"]} to {meta["mag_cutoff"]}.
 */
export const HYG_STAR_COUNT = {N};
export const HYG_POSITIONS_B64 =
  "{base64.b64encode(bytes(pos)).decode()}";
export const HYG_COLORS_B64 =
  "{base64.b64encode(bytes(col)).decode()}";
"""
open(OUT, "w").write(ts)
open("BUILD-RECORD.json", "w").write(json.dumps(meta, indent=2))
print(json.dumps(meta, indent=2))
print("hygData.ts bytes:", len(ts))
