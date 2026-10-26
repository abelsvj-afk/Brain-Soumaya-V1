# ChatGPT audit prompt — Deep Past mockup won't load on Android Chrome

Copy everything below the line into ChatGPT. The source is on GitHub at
`abelsvj-afk/Brain-Soumaya-V1`, branch `mockup/deep-past-v6-audit`, under
`mockups/deep-past/` (`index.html` = the source, `build_deep_past.py` = the
builder that assembles the standalone file).

---

## What this is

A single-file HTML mockup of "Deep Past," a world in the Soumaya Second Brain
app. It is Three.js (vendored, base64-embedded) rendering a nine-stratum helix
descending to a warm basin, with five real GLB pieces embedded as base64. The
source is `mockups/deep-past/index.html`; the builder
`mockups/deep-past/build_deep_past.py` assembles the standalone file that the
owner downloads and opens on his phone.

## The problem

On the owner's Samsung Android phone, in Chrome, opened from a downloaded file
via a `content://media/external/...` URL, the page shows its static HTML
(banner, loading pill, HUD, control panel) but the 3D scene never appears. It
stays stuck on loading. This has happened across versions v2–v6. The same
phone runs WebGL fine (a diagnostic page drew one frame in 79 ms) and loads a
sibling mockup (Eternity, 8.7 MB single file, same wrapper pattern) fine.

## The key evidence (from phone screenshots)

- v5 (11,407,647 bytes): the loading pill still showed its STATIC initial text
  "Loading Deep Past… (v5)" and the HUD its static placeholders. That proves
  NO JavaScript executed at all — the wrapper (the first executable script,
  near the end of the file) never ran. Most likely the file was truncated /
  opened before the download finished.
- v6 (6,873,881 bytes): the pill now says "Starting Deep Past… (v6)". That is
  the heartbeat script (a tiny script right after the loading pill) running —
  so JavaScript DOES execute now. But the scene is still black and the HUD
  still shows static "loading your GLB…" lines. So the main boot (the wrapper)
  has not finished: either it never ran, or it is stuck after the heartbeat.

## File structure (v6 standalone, 6,873,881 bytes)

1. HTML head/body: banner, #app div, #loading pill, #hud (static
   placeholders), control panel buttons.
2. Heartbeat script (right after the pill): sets the pill to "Starting Deep
   Past… (v6)", sets window.__dpHeartbeat, and after 10 s, if
   window.__dpMainBooted is not set, replaces the pill with "The file may not
   have downloaded fully — please download it again from the chat, then reopen
   it".
3. `<script type="text/plain" id="scene-src">` (~53 KB): the Three.js module
   source (scene, strata, lights, stars, camera, GLB load functions).
4. Wrapper (classic `<script>`, ~1.1 MB): base64 three.js core + module +
   GLTFLoader stub; creates blob URLs, adds an importmap (three → blob,
   three/addons/loaders/GLTFLoader.js → blob), creates the module from the
   scene-src blob, appends it. Its first statement sets the pill to "Starting
   Deep Past… (v6)" and sets window.__dpMainBooted = true. After appending the
   module it sets the pill to "Loading the scene code… (v6)". It has a window
   error handler that shows errors on the pill, and a try/catch that writes
   failures to the pill.
5. Menus patch script (collapsible menus).
6. Five `<script type="text/plain" id="glb-*">` blocks: the five GLBs as
   base64 (256-texture web slims, 4.2 MB total). Each load function reads its
   block, decodes it, removes the block, and parses it with GLTFLoader.parse
   (4 args). They decode one at a time after the first frame (setTimeout
   1200/2400/3600/4800/6000 ms).
7. The module hides the loading pill on the first rendered frame (tick()).
   After 20 s, if the pill is still up, it becomes "Still loading (<stage>) —
   tap to reload".

## What to audit

1. Given the v6 screenshot (pill = "Starting Deep Past… (v6)", HUD static,
   black scene): the heartbeat ran but the main boot did not finish. What are
   the possible causes, ranked? Consider: (a) the file is truncated after the
   heartbeat but before/during the wrapper; (b) the wrapper is stuck during
   base64 decoding / blob URL creation / importmap; (c) the module was created
   but failed to evaluate; (d) the module evaluated but the first frame never
   rendered. For each, say what evidence would confirm or rule it out, and
   what the pill would show.
2. Is the blob-URL + dynamically-added-importmap pattern reliable on Android
   Chrome? Is there a race where the module starts before the importmap
   registers? If so, how would it fail and what would the user see?
3. Is there anything in the wrapper or the module that could hang or throw
   silently on a phone (but not in desktop Chromium)? Look at the base64 decode
   (atob on ~1 MB), URL.createObjectURL, the importmap, probeGL (creates a
   canvas + WebGL context), and the first-frame render.
4. The heartbeat's 10 s watchdog: if the wrapper DID run (so __dpMainBooted is
   set) but is stuck, the watchdog never fires and the pill stays on
   "Starting…". Is that a gap? Should the watchdog also cover a stuck wrapper?
5. Recommend the smallest, most robust fix that makes this file actually load
   on the phone. Do NOT redesign the world, change the look, or add features.
   Focus only on the loading/boot reliability. If you recommend splitting the
   file or changing the delivery, say exactly how (what goes where, what the
   user opens).

## Constraints

- The owner opens a single downloaded file on his phone in Chrome via
  content://. He will not run a dev server or install anything.
- Do not change the visual design, the camera, the lighting, or the pieces.
  Only the loading/boot path is in scope.
- The file must stay a single HTML file he can download and open.

Please give: (1) your ranked root-cause analysis for the v6 symptom, (2) the
specific code lines / patterns responsible, (3) the concrete fix in order,
with the exact change to make.
