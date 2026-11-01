#!/usr/bin/env bash
# blender-xvfb.sh — run Blender under a PRIVATE Xvfb display with the
# softwaregl wrapper (bundled Mesa / llvmpipe GL stack).
#
# Why this exists (measured 2026-10-31, see reports/batch-worker-setup.md):
#   - Plain headless `blender -b` dies at startup on this machine:
#     "EGL Error (0x3009): EGL_BAD_MATCH" -> "Warning: No OpenGL vendor
#     detected" -> segfault (exit 139), even with libEGL installed.
#   - EGL_PLATFORM=surfaceless works but is far slower, with long
#     near-idle stalls that make job health hard to judge;
#   - Under xvfb-run (its own display, never the GUI daemon's) +
#     blender-softwaregl, GL works: Workbench and EEVEE both rendered.
# This is the same GL environment the GUI daemon uses, minus the MCP
# addon and minus any shared state. xvfb-run -a always allocates a
# free display, so batch jobs can never collide with the GUI instance.
exec xvfb-run -a "$HOME/workspace/tools/blender-4.2.23/blender-softwaregl" "$@"
