import json, subprocess, sys

CLI = '/home/hatch/workspace/custom-connectors/custom.blender/bin/blender-mcp'
MASTER = '/home/hatch/workspace/Soumaya-Environment-Production/source/soumaya_worlds_master.blend'
ENSURE = ("import bpy\n"
          "if bpy.data.filepath != '" + MASTER + "':\n"
          "    bpy.ops.wm.open_mainfile(filepath='" + MASTER + "')\n"
          "print('ENSURED', bpy.data.filepath)")

def call(code):
    with open('/tmp/args.json', 'w') as f:
        json.dump({"code": code}, f)
    r = subprocess.run([CLI, 'call-tool', '--name', 'execute_blender_code',
                        '--arguments-file', '/tmp/args.json'],
                       capture_output=True, text=True)
    out = r.stdout
    try:
        d = json.loads(out[out.index('{'):])
        for c in d.get('content', []):
            print(c.get('text', '')[:6000])
        if d.get('isError'):
            print("IS-ERROR")
    except Exception:
        print("RAW:", out[-2000:])
        print("STDERR:", r.stderr[-500:])

if __name__ == '__main__':
    call(ENSURE)
    call("exec(open('" + sys.argv[1] + "').read())")
