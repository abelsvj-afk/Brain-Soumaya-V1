"""Job template for the headless Blender batch worker.

Contract (see batch-run.sh / README.md):
  - Blender is invoked as:  blender -b <scene.blend> --python <this file>
    The scene is already loaded when this script runs.
  - $BATCH_OUT_DIR points at jobs/<job-name>.out/ — write ALL outputs
    there (or to absolute paths you choose, but then still announce
    them, see below).
  - For every file you produce, print one line:  BATCH_OUTPUT <path>
    batch-run.sh collects those lines into the status JSON.
  - Print a final human-readable line starting with BATCH_SUMMARY.
  - If something is wrong, raise an exception — batch-run.sh passes
    --python-exit-code 17, so a raised job exits non-zero and the
    status JSON says "failed". Do NOT silently swallow errors and
    exit 0.
  - NEVER save over the scene file you were given, and never write
    outside $BATCH_OUT_DIR unless the job's whole purpose is an
    export to a caller-specified path. Crews pass COPIES of scenes,
    never the live master.
"""

import os
import sys

import bpy

OUT = os.environ["BATCH_OUT_DIR"]


def main():
    scene = bpy.context.scene
    print(f"BATCH: scene={scene.name} engine={scene.render.engine} "
          f"objects={len(scene.objects)}")

    # --- example: render the scene's active camera at its set res ---
    if scene.camera is None:
        raise RuntimeError("scene has no active camera")
    scene.render.filepath = os.path.join(OUT, "render.png")
    bpy.ops.render.render(write_still=True)
    print(f"BATCH_OUTPUT {scene.render.filepath}")

    # --- example: export the scene to GLB ---------------------------
    # The glTF exporter ships with Blender but may need enabling in a
    # fresh config:
    if not hasattr(bpy.ops.export_scene, "gltf"):
        import addon_utils
        addon_utils.enable("io_scene_gltf2", default_set=True)
    glb = os.path.join(OUT, "export.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB")
    print(f"BATCH_OUTPUT {glb}")

    print("BATCH_SUMMARY template job done")


if __name__ == "__main__":
    main()
