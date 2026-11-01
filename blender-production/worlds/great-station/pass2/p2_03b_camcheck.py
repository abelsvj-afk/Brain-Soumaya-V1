import bpy
c = bpy.data.objects["cam02_ring_harbor_closeup"]
print("cam02 loc", [round(v,1) for v in c.location], "rot", [round(v,3) for v in c.rotation_euler], "lens", c.data.lens, "parent", c.parent.name if c.parent else None)
s = bpy.data.objects["rim_segment_00"]
print("seg00 mesh", s.data.name, "verts", len(s.data.vertices), "loc", [round(v,1) for v in s.location])
import bmesh
print("seg00 world bbox via matrix:", [tuple(round(v,1) for v in (s.matrix_world @ __import__('mathutils').Vector(c))) for c in (s.bound_box[0], s.bound_box[6])])
b = bpy.data.objects.get("beacon_00_dome")
print("beacon00 dome:", b.location[:] if b else None, b.data.name if b else None)
h = bpy.data.objects.get("beacon_00_housing")
print("beacon00 housing:", h.location[:] if h else None)
print("filepath:", bpy.data.filepath)
