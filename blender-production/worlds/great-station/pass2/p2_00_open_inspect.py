"""Pass 2 step 0: open master, dump full inventory to JSON on disk."""
import bpy, json, os

MASTER = "/home/hatch/workspace/Soumaya-Environment-Production/source/soumaya_worlds_master.blend"
OUT = "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2/inventory.json"

if bpy.data.filepath != MASTER:
    bpy.ops.wm.open_mainfile(filepath=MASTER)

def holder_of(obj):
    """Topmost anchor: walk parents to the object whose parent is None or a root."""
    chain = []
    o = obj
    while o is not None:
        chain.append(o.name)
        o = o.parent
    return chain

inv = {"file": bpy.data.filepath, "scenes": {}}
for sc in bpy.data.scenes:
    objs = []
    for o in sc.objects:
        d = {"name": o.name, "type": o.type,
             "parent": o.parent.name if o.parent else None,
             "colls": [c.name for c in o.users_collection],
             "loc": [round(v, 2) for v in o.location],
             "hidden": bool(o.hide_render)}
        if o.type == 'MESH':
            me = o.data
            tris = sum(len(p.vertices) - 2 for p in me.polygons)
            d["tris"] = tris
            d["verts"] = len(me.vertices)
            d["mesh"] = me.name
            d["mats"] = [s.material.name if s.material else None for s in o.material_slots]
            d["has_uv"] = len(me.uv_layers) > 0
            d["dims"] = [round(v, 2) for v in o.dimensions]
        if o.type == 'CAMERA':
            d["lens"] = o.data.lens
            d["rot"] = [round(v, 3) for v in o.rotation_euler]
        if o.type == 'LIGHT':
            d["energy"] = o.data.energy
            d["ltype"] = o.data.type
        objs.append(d)
    inv["scenes"][sc.name] = {
        "objects": objs,
        "collections": [c.name for c in sc.collection.children_recursive] if hasattr(sc.collection, 'children_recursive') else [c.name for c in bpy.data.collections],
        "render_engine": sc.render.engine,
        "cam": sc.camera.name if sc.camera else None,
    }
inv["materials"] = sorted([m.name for m in bpy.data.materials])
inv["images"] = [{"name": i.name, "size": list(i.size), "filepath": i.filepath} for i in bpy.data.images]
with open(OUT, "w") as f:
    json.dump(inv, f, indent=1)
print("INVENTORY WRITTEN", OUT, "scenes:", list(inv["scenes"].keys()))
for sname, sd in inv["scenes"].items():
    meshes = [o for o in sd["objects"] if o["type"] == "MESH"]
    print(sname, "objects:", len(sd["objects"]), "meshes:", len(meshes), "tris:", sum(o["tris"] for o in meshes))
