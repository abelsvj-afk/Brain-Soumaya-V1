# Blender batch worker — headless jobs for the Soumaya worlds pipeline

A second, windowless Blender that runs **batch jobs** (texture bakes,
GLB exports, re-import checks, progress renders) from saved scene
files, while the main GUI Blender (MCP daemon, port 9876) keeps
building interactively. Built and proven 2026-10-31 — full evidence in
`../../reports/batch-worker-setup.md`.

## Usage

```bash
cd ~/workspace/Soumaya-Environment-Production/tools/batch-blender
./batch-run.sh <scene.blend> <job.py> <job-name>
```

- One job at a time: a second invocation while one is running exits
  with code 3 and a clear message (flock on `.batch.lock`).
- The job runs niced (CPU priority lowered) and is marked as the
  preferred OOM victim, so a hungry batch job dies before the GUI
  Blender ever does.
- Everything lands in `jobs/`:
  - `<job-name>.log` — full Blender output.
  - `<job-name>.status.json` — status, exit code, duration, outputs.
  - `<job-name>.out/` — the job's output folder, passed to the job
    script as `$BATCH_OUT_DIR`.
  - `<job-name>.pid` — present while running. Kill **that PID** to
    stop the job; it can never affect the GUI instance.
- Optional env: `BATCH_TIMEOUT=<seconds>`, `BATCH_NICE=<level>`,
  `BATCH_BLENDER_BIN=<path>` (default `blender-xvfb.sh`, see below).

## Writing a job

Start from `job-template.py`. The contract:

- Blender runs as `blender -b <scene> --python <job.py>`; the scene
  is already loaded when your script runs.
- Write outputs to `$BATCH_OUT_DIR`; print `BATCH_OUTPUT <path>` for
  each file (they're collected into the status JSON) and a final
  `BATCH_SUMMARY ...` line.
- Raise on failure — `--python-exit-code 17` makes a raised job exit
  non-zero and the status JSON says `failed`. Never swallow errors.
- **Never save over the scene file you were given.**

## The copy-don't-share rule

Crews hand the worker a **copy** of a scene, never the live master
(`source/soumaya_worlds_master.blend`). The GUI may be mid-save or
mid-edit; the worker's copy is a stable snapshot. Save the snapshot,
copy it into `work/`, run the job against the copy.

## What belongs on the worker vs the GUI

| Worker (batch) | GUI instance (interactive) |
| --- | --- |
| Texture bakes (Cycles-native in Blender — the big win) | Modelling, placement, material art |
| GLB exports | EEVEE beauty renders (the approval shots) |
| Re-import validation (open the GLB, diff anchors/boxes) | Anything needing viewport judgement |
| Scripted audits (tri counts, name diffs, file sizes) | |
| Cycles progress renders (framing/geometry checks) | |

## GL findings on this machine (measured, 2026-10-31)

- **Plain headless Blender does not work here.** `blender -b` (even
  via the softwaregl wrapper) dies at startup: `EGL Error (0x3009):
  EGL_BAD_MATCH` → "No OpenGL vendor detected" → segfault — despite
  libEGL being installed system-wide.
- **EGL surfaceless works but is very slow** (`EGL_PLATFORM=surfaceless`
  + system Mesa): a 64×64 EEVEE factory-scene frame took 7m28s of
  render time, with long near-0%-CPU stalls that look exactly like a
  hang. Not used — the Xvfb path is faster and its health is visible.
- **What works:** `blender-xvfb.sh` — a private `xvfb-run` display
  (never the GUI's) + the `blender-softwaregl` wrapper (bundled Mesa /
  llvmpipe). Same GL environment as the GUI daemon, fully separate
  process. Workbench and EEVEE both rendered through it.
- **EEVEE caveat:** it renders headless, but on llvmpipe it cost
  ~5 s/sample at 64×64 (5m11s for one 64-sample frame of the default
  cube). At 640×360 and production sample counts that's impractical.
  Batch renders therefore use **Cycles CPU** (32 samples proved the
  pipeline in 187 s end-to-end). Cycles renders prove framing,
  geometry and materials plumbing — they do **not** reproduce the
  EEVEE-composed look, so approval beauty shots stay on the GUI.
  Bakes are unaffected: Blender bakes through Cycles regardless.

## Machine limits (shared with the GUI)

4 CPUs, ~7 GB RAM total. One batch job at a time is a hard rule, not
a courtesy: a second Blender scene copy in RAM plus the GUI's scene
can pressure memory. The nice level and OOM preference keep the GUI
the survivor if it ever comes to that.
