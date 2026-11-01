# Batch worker setup — headless Blender for the Soumaya pipeline

**Status: BUILT AND PROVEN, 2026-10-31.** A background, windowless
Blender now runs batch jobs (bakes, exports, validation, progress
renders) from saved scene copies while the GUI Blender (MCP daemon,
port 9876) keeps building. The GUI daemon was never stopped,
restarted, or disturbed; its health was verified before and after
the proof run, and the pass-2 crew's work visibly advanced in it
while the proof ran.

## What was built

All under `~/workspace/Soumaya-Environment-Production/tools/batch-blender/`:

- **`batch-run.sh`** — the runner. Usage:
  `batch-run.sh <scene.blend> <job.py> <job-name>`. Enforces one job
  at a time (flock; a concurrent invocation exits 3 with a clear
  message — tested), runs Blender niced at +10 with its OOM score
  raised (+500) so the worker is always the preferred victim, and
  writes `jobs/<name>.log`, `jobs/<name>.status.json` (started /
  finished / exit code / duration / outputs), `jobs/<name>.out/`
  (the job's output dir, passed as `$BATCH_OUT_DIR`), and a
  `jobs/<name>.pid` while running — killing that PID stops the job
  and cannot touch the GUI instance. Optional `BATCH_TIMEOUT`,
  `BATCH_NICE`, `BATCH_BLENDER_BIN`.
- **`blender-xvfb.sh`** — the Blender launcher the runner uses by
  default: a private `xvfb-run` display + the `blender-softwaregl`
  wrapper. This is the GL path that actually works headless here
  (findings below).
- **`job-template.py`** — the job contract: scene pre-loaded, outputs
  to `$BATCH_OUT_DIR`, `BATCH_OUTPUT <path>` lines collected into the
  status JSON, raise-on-error (the runner passes
  `--python-exit-code 17`).
- **`README.md`** — crew-facing usage, the copy-don't-share rule, the
  worker/GUI work split, and the GL findings.
- **`work/`** — the proof's scene copy and job script;
  **`jobs/`** — run logs, status files, and outputs.

## Which render path works headless (the finding that mattered)

Three paths were tried, in order:

1. **Plain headless (`blender -b`, softwaregl wrapper): FAILED.**
   First proof attempt died at startup: `EGL Error (0x3009):
   EGL_BAD_MATCH` → `Warning: No OpenGL vendor detected` → segfault,
   exit 139 after 78 s, right after reading the blend. This is
   despite libEGL + libegl-mesa0 being installed system-wide (they
   were reinstalled today and `ldconfig` sees `libEGL.so.1`).
2. **EGL surfaceless (`EGL_PLATFORM=surfaceless`, system Mesa):
   WORKS, BUT VERY SLOW — and easy to mistake for a hang.** The
   probe was observed for ~5 minutes at near-0% CPU with no output
   and was reported dead; in fact it was crawling. Left alone it
   completed the same 64×64 EEVEE factory-scene render in 7m28s of
   render time and quit normally, producing a valid PNG. (The kill
   sent to its shell session never reached the detached Blender
   child — it kept going and finished.) Not chosen: slowest of the
   working paths, and its stalls make job health hard to judge.
3. **Private Xvfb + softwaregl (`blender-xvfb.sh`): WORKS.** Same GL
   environment the GUI daemon uses (Xvfb display + bundled Mesa /
   llvmpipe), but a fully separate display and process. Diagnostics
   on the factory scene: Workbench 64×64 rendered and saved in 49 s;
   EEVEE 64×64 at 64 samples rendered and saved in 5m11s.

**The EEVEE caveat, plainly:** EEVEE *does* render headless through
this path, but on llvmpipe it costs ~5 s per sample even at 64×64,
so production-resolution EEVEE beauty renders are impractical on the
worker. The proof render (and batch progress renders generally)
therefore uses **Cycles CPU** — which is also what Blender bakes
with natively, so the worker's main jobs (bakes, exports, checks)
are unaffected. Cycles output proves framing/geometry/pipeline; it
does not reproduce the EEVEE-composed look. Approval shots stay on
the GUI.

## Proof run evidence (verified on disk)

Job `proof2`, scene = a copy of the live master
(`work/proof-master-copy.blend`, 14,400,420 bytes, snapshotted at
15:54 EDT while the crew's build was actively growing the master —
the master itself was never opened for writing), script
`work/proof-station.py`:

- **Wall clock: 187 s** (12:06:35–12:09:41 PM EDT), **exit code 0**,
  status JSON `success` with both outputs recorded.
- **Render:** `jobs/proof2.out/proof-exterior-overview.png` —
  234,529 bytes, 640×360 RGBA, opened and inspected: it shows the
  station's exterior modules with lit windows, the great ring
  curving through frame, and the striped backdrop planet. (Dark and
  off-centre — Cycles at 32 samples/no denoise reading a scene
  composed for EEVEE, from a mid-pass-2 snapshot; the pipeline is
  what's being proved, not the art.)
- **Export:** `jobs/proof2.out/proof-exterior.glb` — 9,962,020
  bytes, `glTF` magic verified.
- **Camera/scene fact found along the way:** the master file's six
  cameras (`cam01_exterior_overview` … `cam06_interior_observation`)
  all live in the `STATION_INTERIOR` scene; `STATION_EXTERIOR` holds
  no camera. The job rendered through `cam01_exterior_overview` as
  intended. Future job scripts should pick cameras by name across
  scenes, exactly as the proof job does.
- **First attempt (`proof1`)** is preserved in `jobs/proof1.*` as
  the EGL segfault evidence (status `failed`, exit 139, 78 s) —
  the runner's failure path (status JSON, outputs collection,
  non-zero exit) was exercised by it for free.
- **Lock test:** with the lock held, a second invocation refused in
  ~1 s with exit 3 and never launched Blender.

## GUI daemon: untouched, verified twice

- **Before:** `get_scene_info` via the MCP CLI answered (87 s — the
  addon queues behind the crew's running code): scene
  `STATION_EXTERIOR`, 299 meshes, active object `dressing_drydock`.
- **After:** same daemon process (pid 4243, port 9876 listening
  throughout), answered in ~43 s, `isError: false`, scene
  `STATION_EXTERIOR`, active object now `traffic_01` — the pass-2
  crew's build advanced normally during the entire proof.

## Limitations

- **One CPU pool, shared.** The VM has 4 CPUs and ~7 GB RAM. The
  worker overlaps the GUI's *waiting* (bakes/renders/exports no
  longer block interactive building), but when both crunch at once
  each runs slower. The one-job lock is also a memory rule: two
  scene copies plus the GUI's scene would pressure RAM. The worker
  runs niced and OOM-marked so the GUI always wins a contention.
- **No EEVEE beauty renders on the worker** (llvmpipe speed, above).
- **Snapshots, not live state.** The worker only sees the scene as
  of the copy's save. A bake/export queue therefore runs at stage
  boundaries: save → copy → hand off → build on.

## How the next world builds should split the work

1. Build interactively in the GUI as today, saving stage snapshots.
2. At each stage boundary, copy the snapshot to the worker and queue
   the batch list: texture bakes first (the pass-2 waits were the
   single biggest time sink, and bakes are Cycles-native — the
   worker's home ground), then GLB export, then a re-import
   validation job (open the GLB fresh, diff anchor names and
   bounding boxes against the inventory, report tri/file numbers).
3. Cycles progress renders on the worker for framing checks while
   building continues; the six EEVEE approval shots stay on the GUI
   at the end.
4. Check `jobs/*.status.json` instead of watching the GUI — a failed
   batch job says so there, with its log, without interrupting the
   build.
