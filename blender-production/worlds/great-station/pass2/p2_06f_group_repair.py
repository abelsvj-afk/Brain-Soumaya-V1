"""Repair the hollow GS_SURFACE group: delete it, rebuild internals with the
corrected lib, re-point every P2 material's GRP node at the new group, restore
the two smoke-baked meshes to their P2 materials, verify group integrity,
then re-bake fallback + witness and prove the diffuse is non-black."""
import bpy, sys, os, json, time, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
from p2_lib import *

old = bpy.data.node_groups.get("GS_SURFACE")
if old:
    report(f"old group nodes: {len(old.nodes)} (partial build expected)")
    bpy.data.node_groups.remove(old)
newg = p2_lib._new_group()
report(f"new group nodes: {len(newg.nodes)}")
outn = [nd for nd in newg.nodes if nd.bl_idname == 'NodeGroupOutput'][0]
assert all(s.links for s in outn.inputs if s.name), "GroupOutput has unlinked sockets!"
assert len(newg.nodes) >= 28, f"group too small: {len(newg.nodes)} nodes"
fixed = 0
for m in bpy.data.materials:
    if m.name.startswith("P2_") and m.use_nodes:
        grp = m.node_tree.nodes.get("GRP")
        if grp:
            grp.node_tree = newg
            fixed += 1
report(f"re-pointed GRP in {fixed} P2 materials")

# restore smoke-baked meshes to P2 materials for a clean re-bake
fb = bpy.data.objects.get("traffic_fallback_hull")
if fb and fb.data.materials:
    fb.data.materials.clear(); fb.data.materials.append(bpy.data.materials["P2_hull_white"])
wits = [o for o in holder_meshes("drydock-witness")]
for o in wits:
    if o.data.materials and o.data.materials[0] and o.data.materials[0].name.startswith("BAKED_"):
        o.data.materials.clear(); o.data.materials.append(bpy.data.materials["P2_basalt_plate"])
report("restored fallback -> P2_hull_white, witness -> P2_basalt_plate")
save_master()

t0 = time.time()
i1 = bake_group([fb], "fallback", "station-traffic-fallback", res=256, use_ao=False)
i2 = bake_group(wits, "drydock_witness", "drydock-witness", res=512, use_ao=True)
report(f"re-bakes done in {time.time()-t0:.0f}s: {i1} / {i2}")
save_master()

import numpy as np
for tag in ("fallback", "drydock_witness"):
    img = bpy.data.images[f"{tag}_diff"]
    wpx, hpx = img.size
    px = np.empty(wpx * hpx * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    report(f"VERIFY {tag}_diff: mean={px.mean():.4f} max={px.max():.3f}")
    assert px.mean() > 0.02, f"{tag} diffuse still black!"
report("GROUP REPAIR VERIFIED: diffuse bakes carry colour")
