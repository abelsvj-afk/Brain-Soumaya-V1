import bpy
m = bpy.data.materials.new("RNA_TEST"); m.use_nodes = True
v = m.node_tree.nodes.new("ShaderNodeTexVoronoi")
props = [p.identifier for p in v.bl_rna.properties if not p.is_readonly]
print("VORONOI writable props:", props)
print("feature-ish:", [(p, getattr(v, p, 'N/A')) for p in props if 'feat' in p or 'dim' in p or 'dist' in p])
g = bpy.data.node_groups.get("GS_SURFACE")
print("group exists:", bool(g))
if g:
    for nd in g.nodes:
        if nd.bl_idname == 'ShaderNodeTexVoronoi':
            print("group voronoi:", nd.name, "feature_type=", getattr(nd, 'feature_type', 'MISSING'),
                  "distance=", getattr(nd, 'distance', 'MISSING'))
print("P2_basalt_plate exists:", bool(bpy.data.materials.get("P2_basalt_plate")))
bpy.data.materials.remove(m)
