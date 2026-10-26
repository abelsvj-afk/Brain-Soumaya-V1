#!/usr/bin/env python3
"""Build the single-file Deep Past live mockup (v2) from mockups/deep-past/index.html.

Embeds: three core+module (base64, as the station standalone does),
GLTFLoader-stub (base64, importmap-mapped to three/addons/loaders/GLTFLoader.js),
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
OUT = pathlib.Path('/home/hatch/workspace/your_files/worlds-mockups-live/deep-past-5pieces-v6.html')

def b64(p):
    return base64.b64encode(pathlib.Path(p).read_bytes()).decode()

# (web slim filename, inert-text block id) — one row per placed piece.
# 2026-10-26: the web slims are the 256-texture versions. The 512-texture
# slims made the standalone 11.4 MB and the owner's phone ran NO JavaScript
# at all on it (his v5 screenshot proved it: the loading pill still showed
# its static initial text, the HUD its static placeholders, black scene —
# the wrapper near the end of the file never executed). The two-piece file
# and Eternity (8.7 MB) loaded fine on the same phone, so the file got too
# big to download/open reliably. 256 textures cut the five GLBs from 7.7 MB
# to 4.2 MB, so the standalone is now ~8 MB, under Eternity's working size.
# A heartbeat script now sits right after the loading pill and proves JS
# runs; if the main boot never starts it says the file may not have
# downloaded fully. The output is renamed again (deep-past-5pieces-v6.html)
# so his phone cannot serve a cached copy of the old file by mistake.
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
try {
/* Say where the boot is, so a stall is visible instead of a frozen pill. */
var _lp = document.getElementById('loading');
if (_lp) _lp.textContent = 'Starting Deep Past… (v6)';
window.__dpMainBooted = true; /* the heartbeat watchdog watches for this */
/* Surface any failure (module error, WebGL throw) on the loading pill
   itself — a silent loading screen is how the owner's phone got stuck. */
window.addEventListener('error', function (ev) {
  var el = document.getElementById('loading');
  if (el && el.style.display !== 'none') {
    el.textContent = 'The scene hit a problem: ' + (ev.message || 'unknown error') + ' — tap to dismiss';
    el.style.pointerEvents = 'auto'; el.style.cursor = 'pointer';
    el.addEventListener('click', function () { el.style.display = 'none'; });
  }
});
const CORE_B64 = '""" + b64(BASE / 'mockups/deep-past/three.core.min.js') + """';
const MOD_B64 = '""" + b64(BASE / 'mockups/deep-past/three.module.min.js') + """';
const LOADER_B64 = '""" + b64(BASE / 'mockups/man-god/GLTFLoader-stub.js') + """';
const dec = new TextDecoder();
const coreUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(CORE_B64), c => c.charCodeAt(0))], {type: 'text/javascript'}));
const modText = dec.decode(Uint8Array.from(atob(MOD_B64), c => c.charCodeAt(0))).split('./three.core.min.js').join(coreUrl);
const modUrl = URL.createObjectURL(new Blob([modText], {type: 'text/javascript'}));
const loaderUrl = URL.createObjectURL(new Blob([dec.decode(Uint8Array.from(atob(LOADER_B64), c => c.charCodeAt(0)))], {type: 'text/javascript'}));
const im = document.createElement('script');
im.type = 'importmap';
im.textContent = JSON.stringify({imports: {'three': modUrl, 'three/addons/loaders/GLTFLoader.js': loaderUrl}});
document.head.appendChild(im);
const sceneUrl = URL.createObjectURL(new Blob([document.getElementById('scene-src').textContent], {type: 'text/javascript'}));
const s = document.createElement('script'); s.type = 'module'; s.src = sceneUrl; document.body.appendChild(s);
/* The module is now fetching/evaluating; if it never starts, the pill
   stays on this stage, which names exactly where the boot stopped. */
if (_lp) _lp.textContent = 'Loading the scene code… (v6)';
} catch (err) {
  var msg = 'The scene failed to start (' + (err && err.message ? err.message : err) + ') — tap to reload';
  var lp = document.getElementById('loading');
  if (lp) { lp.textContent = msg; lp.style.pointerEvents = 'auto'; lp.style.cursor = 'pointer'; lp.addEventListener('click', function () { location.reload(); }); }
  var b = document.getElementById('behavOut');
  if (b){ b.textContent += (b.textContent ? '\\n' : '') + '• ' + msg; }
}
})();
</script>
<script>
""" + menu + """
</script>
""" + glb_blocks + """</body>"""
html = html.replace('</body>', wrapper)
OUT.write_text(html)
print('deep-past-5pieces-v6.html', len(html), 'bytes')
