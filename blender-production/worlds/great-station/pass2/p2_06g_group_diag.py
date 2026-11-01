import bpy, sys, importlib
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station/pass2")
sys.path.insert(0, "/home/hatch/workspace/Soumaya-Environment-Production/worlds/great-station")
import p2_lib
importlib.reload(p2_lib)
old = bpy.data.node_groups.get("GS_SURFACE")
print("existing group nodes:", len(old.nodes) if old else None)
if old:
    bpy.data.node_groups.remove(old)
g = p2_lib._new_group()
print("new group nodes:", len(g.nodes))
for nd in g.nodes:
    if nd.bl_idname == 'NodeGroupOutput':
        for s in nd.inputs:
            print("OUT", s.name, "linked:", bool(s.links), (s.links[0].from_node.name if s.links else ""))
    if nd.bl_idname == 'NodeGroupInput':
        print("GroupInput outputs:", [s.name for s in nd.outputs])
