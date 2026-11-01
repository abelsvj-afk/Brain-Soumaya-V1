"""Probe: datablock sharing, rotations, lights, remaining room detail."""
import bpy, json
out = []
seg = bpy.data.objects.get("rim_segment_00")
out.append(f"rim seg meshes: {len({o.data.name for o in bpy.data.objects if o.name.startswith('rim_segment')})} unique datablocks")
for n in ("rim_segment_00", "rim_segment_01", "rim_segment_12", "rim_segment_24"):
    o = bpy.data.objects[n]
    out.append(f"{n}: mesh={o.data.name} rot={[round(v,3) for v in o.rotation_euler]} scale={[round(v,2) for v in o.scale]} parent={o.parent.name}")
for pref in ("traffic", "docked"):
    hs = [o for o in bpy.data.objects if o.type=='MESH' and o.parent and o.parent.name.startswith(pref)]
    out.append(f"{pref} meshes: {[(o.name, o.data.name) for o in hs]}")
out.append("LIGHTS: " + str([(o.name, o.data.type, o.data.energy, o.parent.name if o.parent else None, o.users_collection[0].name if o.users_collection else '?') for o in bpy.data.objects if o.type=='LIGHT']))
for scname in ("STATION_EXTERIOR", "STATION_INTERIOR"):
    sc = bpy.data.scenes[scname]
    out.append(f"{scname}: world={sc.world.name if sc.world else None} engine={sc.render.engine} res={sc.render.resolution_x}x{sc.render.resolution_y}")
    out.append(f"  view: {sc.view_settings.view_transform}/{sc.view_settings.look} exposure={sc.view_settings.exposure}")
    out.append(f"  eevee taa={sc.eevee.taa_render_samples} bloom_attr={hasattr(sc.eevee,'use_bloom')}")
for holder in ("hangar-bay", "commission-board", "fleet-deck", "interior-deck-viewport-lintel", "interior-rim-arc", "observation-deck"):
    hs = [o for o in bpy.data.objects if o.type=='MESH' and o.parent and o.parent.name==holder]
    out.append(f"HOLDER {holder}:")
    for o in hs:
        out.append(f"   {o.name:38s} tris={sum(len(p.vertices)-2 for p in o.data.polygons):5d} mats={[s.material.name if s.material else None for s in o.material_slots]} dims={[round(v,1) for v in o.dimensions]} loc={[round(v,1) for v in o.location]}")
print("\n".join(out))
with open("/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2/probe.txt", "w") as f:
    f.write("\n".join(out))
