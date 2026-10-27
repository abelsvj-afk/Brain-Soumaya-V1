#!/usr/bin/env python3
"""Build the single-file Deep Past live mockup (v7) from mockups/deep-past/index.html.

Embeds: three core+module (base64, as the station standalone does),
GLTFLoader-stub (base64; its 'three' import is rewritten to the generated
module Blob URL at boot, and the scene's two imports are rewritten to the
generated Blob URLs — v7 removed the dynamic import map per the ChatGPT
audit, so there is no import-map timing to fail silently),
the five placed GLBs (base64), plus the orbit-camera and collapsible-menus
live-viewing patches. Each new piece adds one load call + one base64 block;
keep them paired.

2026-10-26 PHONE LESSON — the five GLBs used to ride inside the wrapper
as JavaScript string literals (window.__DP_*_B64). That made the wrapper a
single 25 MB classic script, and the browser had to parse all 24 MB of
base64 AS JavaScript before ANY of it could run — on the owner's phone the
page sat on the loading pill with a black scene and the menus stuck open
(the patch script sits after the giant script, so it had not run either).
The GLBs now ride as <script type="text/plain"> blocks (inert text — the
browser scans past them without parsing them as code), placed AFTER the
wrapper + menus patch, and each load function reads its block from the DOM
and removes it after decoding. The wrapper is back down to ~2 MB of JS
(three.js only), so the scene starts in seconds and the pieces land one at
a time after the first frame.
"""
import base64, pathlib, re, sys

BASE = pathlib.Path('/home/hatch/workspace/worlds-vision')
SRC = BASE / 'mockups/deep-past/index.html'
OUT = pathlib.Path('/home/hatch/workspace/your_files/worlds-mockups-live/deep-past-5pieces-v7.html')

def b64(p):
    return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

# (web slim filename, inert-text block id) — one row per placed piece.
# 2026-10-26: the web slims are the 256-texture versions (file 11.4 → 6.9 MB;
# the owner's phone ran no JS at all on the 11.4 MB file). v7 (ChatGPT audit,
# owner-approved) reworks the boot: stage markers for every step, no dynamic
# import map (the imports are rewritten to the generated Blob URLs), and a
# stage-aware failure report on the pill. The output is renamed again
# (deep-past-5pieces-v7.html) so his phone cannot serve a cached copy of the
# old file by mistake.
PIECES = [
    ('first-light-basin-web-256.glb', 'glb-basin'),
    ('stratum-terrace-web-256.glb', 'glb-terrace'),
    ('rim-web-256.glb', 'glb-rim'),
    ('descent-stair-web-256.glb', 'glb-stair'),
    ('stratum-lantern-web-256.glb', 'glb-lantern'),
]

html = SRC.read_text()
mod = re.search(r'<script type="module">(.*?)</script>', html, re.S)
assert mod, 'module script not found'
scene_src = mod.group(1)

# Repo version loads the GLB file; standalone parses the embedded bytes.
# The bytes live in an inert <script type="text/plain"> block in the page;
# the load function reads its block, decodes it, and removes the block
# (freeing the text) — never a JS string literal, never parsed as code.
for fname, elid in PIECES:
    old_load = "new GLTFLoader().load('./" + fname + "', (g) => {"
    assert old_load in scene_src, fname
    new_load = ("new GLTFLoader().parse((() => { const el = document.getElementById('" + elid + "'); "
                "const bin = atob(el.textContent); el.remove(); "
                "const u = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i); "
                "return u.buffer; })(), '', (g) => {")
    scene_src = scene_src.replace(old_load, new_load)

# GLTFLoader.parse takes FOUR args (data, path, onLoad, onError); the
# repo .load call carries an onProgress slot (undefined) that parse
# would swallow as onError and silently drop the real error handler.
# That dropped handler is exactly how the Eternity loading screen got
# stuck on the owner's phone: any hiccup left the overlay up forever.
assert "}, undefined, (e) => {" in scene_src
scene_src = scene_src.replace("}, undefined, (e) => {", "}, (e) => {")

orbit = pathlib.Path('/home/hatch/workspace/soumaya-visual2/orbit_patch.js').read_text()
menu = pathlib.Path('/home/hatch/workspace/soumaya-visual2/menu_patch_mg.js').read_text()
scene_src = scene_src + orbit
pathlib.Path('/home/hatch/workspace/worlds-vision/builds/deep-past.mjs').write_text(scene_src)

html = re.sub(r'<script type="importmap">.*?</script>', '', html, flags=re.S)
html = html.replace(mod.group(0), '<script type="text/plain" id="scene-src">' + scene_src + '</script>')

# The GLB blocks go AFTER the wrapper + menus patch, so the browser runs
# the boot code and collapses the menus before it scans the 24 MB of text.
glb_blocks = ''.join(
    '<script type="text/plain" id="' + elid + '">' + b64(BASE / 'mockups/deep-past' / fname) + '</script>\n'
    for fname, elid in PIECES
)

wrapper = """
<script>
(async () => {
/* v7 boot stages (ChatGPT audit): window.__dpBootStage names the current
   step — wrapper-entered, core-decoding, module-decoding, blob-creation,
   module-loading — and the module adds renderer-creation and first-frame.
   The heartbeat watchdog reads this, so a wrapper that starts and then
   stalls is diagnosable instead of invisible. The old single
   __dpMainBooted flag (set the moment the wrapper started) could not tell
   "never started" from "started but stalled". */
function setStage(s){ window.__dpBootStage = s; }
function fail(msg){
  var stage = window.__dpBootStage || 'unknown';
  var text = 'The scene failed at ' + stage + ': ' + msg + ' — tap to reload';
  var lp = document.getElementById('loading');
  if (lp) { lp.textContent = text; lp.style.pointerEvents = 'auto'; lp.style.cursor = 'pointer'; lp.addEventListener('click', function(){ location.reload(); }); }
  var b = document.getElementById('behavOut');
  if (b){ b.textContent += (b.textContent ? '\\n' : '') + '• ' + text; }
}
/* Replace a specifier exactly once; throw if it is missing or duplicated,
   so a bad replacement can never silently produce a broken module. */
function replaceOnce(text, from, to, label){
  var i = text.indexOf(from);
  if (i === -1) throw new Error('missing import ' + label);
  if (text.indexOf(from, i + from.length) !== -1) throw new Error('import ' + label + ' occurs more than once');
  return text.slice(0, i) + to + text.slice(i + from.length);
}
try {
setStage('wrapper-entered');
var _lp = document.getElementById('loading');
if (_lp) _lp.textContent = 'Starting Deep Past… (v7)';
/* Surface any failure on the loading pill — a silent loading screen is how
   the owner's phone got stuck. */
window.addEventListener('error', function (ev) { fail(ev.message || 'unknown error'); });
window.addEventListener('unhandledrejection', function (ev) {
  var r = ev.reason;
  fail('unhandled rejection: ' + (r && r.message ? r.message : r));
});
const CORE_B64 = '""" + b64(BASE / 'mockups/deep-past/three.core.min.js') + """';
const MOD_B64 = '""" + b64(BASE / 'mockups/deep-past/three.module.min.js') + """';
const LOADER_B64 = '""" + b64(BASE / 'mockups/man-god/GLTFLoader-stub.js') + """';
const dec = new TextDecoder();
setStage('core-decoding');
const coreUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(CORE_B64), c => c.charCodeAt(0))], {type: 'text/javascript'}));
setStage('module-decoding');
const modText = dec.decode(Uint8Array.from(atob(MOD_B64), c => c.charCodeAt(0))).split('./three.core.min.js').join(coreUrl);
const modUrl = URL.createObjectURL(new Blob([modText], {type: 'text/javascript'}));
/* No import map (v7): the loader stub's 'three' import is rewritten to the
   generated module URL, so the loader and the scene share one Three.js
   instance without a runtime import map that can fail silently. */
const loaderText = replaceOnce(dec.decode(Uint8Array.from(atob(LOADER_B64), c => c.charCodeAt(0))), "'three'", JSON.stringify(modUrl), 'three');
const loaderUrl = URL.createObjectURL(new Blob([loaderText], {type: 'text/javascript'}));
setStage('blob-creation');
/* Rewrite the scene's imports to the generated Blob URLs (longer specifier
   first, so it cannot be shadowed by the shorter one). */
let sceneText = document.getElementById('scene-src').textContent;
sceneText = replaceOnce(sceneText, "'three/addons/loaders/GLTFLoader.js'", JSON.stringify(loaderUrl), 'GLTFLoader');
sceneText = replaceOnce(sceneText, "'three'", JSON.stringify(modUrl), 'three');
const sceneUrl = URL.createObjectURL(new Blob([sceneText], {type: 'text/javascript'}));
setStage('module-loading');
const s = document.createElement('script'); s.type = 'module'; s.src = sceneUrl;
s.addEventListener('error', function(){ fail('module script failed to load'); });
document.body.appendChild(s);
/* The module is now fetching/evaluating; if it never starts, the pill
   stays on this stage, which names exactly where the boot stopped. */
if (_lp) _lp.textContent = 'Loading the scene code… (v7)';
} catch (err) {
  fail(err && err.message ? err.message : err);
}
})();
</script>
<script>
""" + menu + """
</script>
""" + glb_blocks + """</body>"""
html = html.replace('</body>', wrapper)
OUT.write_text(html)
print('deep-past-5pieces-v7.html', len(html), 'bytes')
