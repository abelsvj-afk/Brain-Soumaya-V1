import bpy
for sc in bpy.data.scenes:
    w = sc.world
    info = "no world"
    if w and w.use_nodes:
        bg = w.node_tree.nodes.get("Background")
        if bg:
            info = f"color={[round(c,3) for c in bg.inputs[0].default_value]} strength={round(bg.inputs[1].default_value,2)}"
    print(f"{sc.name}: world={w.name if w else None} {info} engine={sc.render.engine}")
ext = bpy.data.scenes["STATION_EXTERIOR"]
roots = [o.name for o in ext.objects if o.parent is None and o.type not in ('CAMERA','LIGHT')]
print("exterior parentless non-cam/light objects:", roots)
stray = [o.name for o in bpy.data.objects if not o.users_collection or o.users_collection[0].name == 'Scene Collection']
print("objects in 'Scene Collection':", stray[:20])
for o in bpy.data.objects:
    if o.type == 'MESH' and o.parent is None and o.name not in ('star_dome',):
        print("PARENTLESS MESH:", o.name, [round(v,1) for v in o.location], [round(v,1) for v in o.dimensions], o.users_collection[0].name if o.users_collection else None)
