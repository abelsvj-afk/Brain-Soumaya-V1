import json, subprocess, sys
CLI = "/home/hatch/workspace/custom-connectors/custom.blender/bin/blender-mcp"
MASTER = "/home/hatch/workspace/Soumaya-Environment-Production/source/soumaya_worlds_master.blend"
group, script = sys.argv[1], sys.argv[2]
def call(code):
    p = "/tmp/args.json"
    json.dump({"code": code}, open(p, "w"))
    r = subprocess.run([CLI, "call-tool", "--name", "execute_blender_code",
                        "--arguments-file", p], capture_output=True, text=True, timeout=280)
    print(r.stdout[-3000:])
ensure = (f"import bpy\nif bpy.data.filepath != '{MASTER}':\n"
          f"    bpy.ops.wm.open_mainfile(filepath='{MASTER}')\n"
          f"print('ENSURED', bpy.data.filepath)")
call(ensure)
src = open(script).read()
call(f"GROUP = {group!r}\n" + src)
