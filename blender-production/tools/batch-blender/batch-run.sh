#!/usr/bin/env bash
# batch-run.sh — run ONE headless Blender batch job for the Soumaya
# Environment Production pipeline.
#
# Usage:
#   batch-run.sh <scene.blend> <job.py> <job-name>
#
# What it does:
#   - Runs Blender in background mode (-b, no window, no MCP, never
#     touches port 9876 or the GUI daemon) on <scene.blend>, executing
#     <job.py> after the scene loads.
#   - Refuses to start if another batch job is already running
#     (flock on .batch.lock, held for the whole run).
#   - Runs the Blender process niced (lower CPU priority) and marks it
#     as the preferred OOM victim so a memory-hungry batch job is
#     killed before the GUI instance ever is.
#   - Creates jobs/<job-name>.out/ and exports it to the job script as
#     $BATCH_OUT_DIR — the job writes its outputs there.
#   - Writes jobs/<job-name>.log (full Blender stdout/stderr),
#     jobs/<job-name>.pid (the worker's PID — kill THAT pid to stop
#     the job; it cannot affect the GUI Blender), and
#     jobs/<job-name>.status.json (started/finished/exit code/outputs).
#     Outputs are collected from "BATCH_OUTPUT <path>" lines the job
#     prints (see job-template.py).
#
# Optional env:
#   BATCH_BLENDER_BIN  Blender executable (default: blender-xvfb.sh in
#                      this folder — Blender under a private Xvfb with
#                      the softwaregl stack; plain headless segfaults
#                      on this machine, see README.md)
#   BATCH_TIMEOUT      Seconds after which the job is killed
#                      (default: no timeout)
#   BATCH_NICE         Nice level (default: 10)
#
# Exit codes: 0 job succeeded · 2 bad usage · 3 another job running ·
# otherwise the job's own exit code (17 = job script raised, via
# --python-exit-code).

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JOBS_DIR="$HERE/jobs"
LOCKFILE="$HERE/.batch.lock"
BLENDER_BIN="${BATCH_BLENDER_BIN:-$HERE/blender-xvfb.sh}"
NICE_LEVEL="${BATCH_NICE:-10}"

if [ $# -ne 3 ]; then
  echo "usage: batch-run.sh <scene.blend> <job.py> <job-name>" >&2
  exit 2
fi
SCENE="$1"; JOB="$2"; NAME="$3"

case "$NAME" in
  *[!A-Za-z0-9._-]*|"")
    echo "job-name must be [A-Za-z0-9._-]+" >&2; exit 2 ;;
esac
[ -f "$SCENE" ] || { echo "scene not found: $SCENE" >&2; exit 2; }
[ -f "$JOB" ]   || { echo "job script not found: $JOB" >&2; exit 2; }
[ -x "$BLENDER_BIN" ] || { echo "blender binary not executable: $BLENDER_BIN" >&2; exit 2; }

SCENE="$(cd "$(dirname "$SCENE")" && pwd)/$(basename "$SCENE")"
JOB="$(cd "$(dirname "$JOB")" && pwd)/$(basename "$JOB")"

# --- one job at a time -------------------------------------------------
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "another batch job is already running (lock: $LOCKFILE)" >&2
  exit 3
fi

LOG="$JOBS_DIR/$NAME.log"
STATUS="$JOBS_DIR/$NAME.status.json"
PIDFILE="$JOBS_DIR/$NAME.pid"
OUTDIR="$JOBS_DIR/$NAME.out"
mkdir -p "$OUTDIR"

write_status() {
  # $1 = status string, $2 = exit code (or ""), $3 = duration s (or "")
  python3 - "$STATUS" "$NAME" "$SCENE" "$JOB" "$OUTDIR" "$LOG" "$1" "$2" "$3" <<'PYEOF'
import json, sys
from datetime import datetime, timezone
(path, name, scene, job, outdir, log, status, rc, dur) = sys.argv[1:10]
data = {}
try:
    with open(path) as f:
        data = json.load(f)
except Exception:
    data = {"job": name, "scene": scene, "script": job,
            "out_dir": outdir, "log": log,
            "started_at": datetime.now(timezone.utc).astimezone().isoformat()}
data["status"] = status
if status != "running":
    data["finished_at"] = datetime.now(timezone.utc).astimezone().isoformat()
    data["exit_code"] = int(rc) if rc != "" else None
    if dur != "":
        data["duration_s"] = round(float(dur), 1)
    outputs = []
    try:
        with open(log, errors="replace") as f:
            for line in f:
                if line.startswith("BATCH_OUTPUT "):
                    outputs.append(line.split(None, 1)[1].strip())
    except Exception:
        pass
    data["outputs"] = outputs
with open(path, "w") as f:
    json.dump(data, f, indent=1)
PYEOF
}

# Env the headless worker needs (mirrors the GUI daemon's quirks):
# HOME so Blender finds user config; a private XDG_RUNTIME_DIR so any
# display probe fails cleanly instead of colliding with the GUI's.
export HOME="${HOME:-/home/hatch}"
export XDG_RUNTIME_DIR="$HERE/xdg-runtime"
export BATCH_OUT_DIR="$OUTDIR"
export BATCH_JOB_NAME="$NAME"

START_S=$(date +%s)
write_status running "" ""
echo "batch job '$NAME' starting: $BLENDER_BIN -b $SCENE --python $JOB" >"$LOG"

if [ -n "${BATCH_TIMEOUT:-}" ]; then
  timeout --signal=TERM "${BATCH_TIMEOUT}" \
    nice -n "$NICE_LEVEL" "$BLENDER_BIN" -b "$SCENE" -noaudio \
      --python-exit-code 17 --python "$JOB" >>"$LOG" 2>&1 &
else
  nice -n "$NICE_LEVEL" "$BLENDER_BIN" -b "$SCENE" -noaudio \
    --python-exit-code 17 --python "$JOB" >>"$LOG" 2>&1 &
fi
BPID=$!
echo "$BPID" >"$PIDFILE"
# Prefer this worker as the OOM victim (raising our own child's score
# is always permitted); protects the GUI Blender under memory pressure.
echo 500 >"/proc/$BPID/oom_score_adj" 2>/dev/null || true

wait $BPID
RC=$?
END_S=$(date +%s)
DUR=$((END_S - START_S))
rm -f "$PIDFILE"

if [ $RC -eq 0 ]; then
  write_status success "$RC" "$DUR"
else
  write_status failed "$RC" "$DUR"
fi
echo "batch job '$NAME' finished: exit $RC in ${DUR}s (log: $LOG)"
exit $RC
