import bpy
out = []
out.append(f"has view_layer: {hasattr(bpy.context, 'view_layer')}")
try:
    out.append(f"view_layer: {bpy.context.view_layer}")
except Exception as e:
    out.append(f"view_layer ERR {e}")
try:
    out.append(f"scene: {bpy.context.scene.name if bpy.context.scene else None}")
except Exception as e:
    out.append(f"scene ERR {e}")
before = set(bpy.data.objects)
bpy.ops.mesh.primitive_cube_add(location=(9999, 9999, 9999))
new = [o for o in bpy.data.objects if o not in before]
out.append(f"primitive_add created: {[o.name for o in new]}")
try:
    bpy.context.view_layer.objects.active = new[0]
    out.append(f"view_layer active set OK -> {bpy.context.view_layer.objects.active.name}")
except Exception as e:
    out.append(f"active set ERR {e}")
try:
    ao = bpy.context.active_object
    out.append(f"context.active_object: {ao}")
except Exception as e:
    out.append(f"context.active_object ERR {type(e).__name__}: {e}")
# selection + join test
bpy.ops.mesh.primitive_cube_add(location=(9999, 9999, 9995))
new2 = [o for o in bpy.data.objects if o not in before and o not in new]
alln = new + new2
try:
    bpy.ops.object.select_all(action='DESELECT')
    for o in alln:
        o.select_set(True)
    bpy.context.view_layer.objects.active = alln[0]
    bpy.ops.object.join()
    out.append(f"join OK -> active now: {bpy.context.view_layer.objects.active.name}")
except Exception as e:
    out.append(f"join ERR {type(e).__name__}: {e}")
# edit mode + smart uv test on the joined cube
try:
    o = bpy.context.view_layer.objects.active
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.05, island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    out.append("smart_project OK")
except Exception as e:
    out.append(f"smart_project ERR {type(e).__name__}: {e}")
# modifier apply test
try:
    o = bpy.context.view_layer.objects.active
    mod = o.modifiers.new("bev", 'BEVEL'); mod.width = 0.2
    bpy.ops.object.modifier_apply(modifier="bev")
    out.append("modifier_apply OK")
except Exception as e:
    out.append(f"modifier_apply ERR {type(e).__name__}: {e}")
for o in list(bpy.data.objects):
    if o.location.x > 9000:
        bpy.data.objects.remove(o, do_unlink=True)
out.append("cleanup done")
print("\n".join(out))
