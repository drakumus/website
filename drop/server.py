"""Drop server: tailnet-only previewer for agent deliverables (see ~/specs/drop-server.md).

Serves DROP_ROOT read-only as a single-page file browser: a newest-first file list
grouped by directory, with an inline preview pane (HTML, images, STL/3MF model
assemblies, markdown, text, PDF, video). GET-only, stdlib-only, no upload routes.

Routes:
  /                  browser UI (newest file preselected)
  /d/<path>          browser UI with <path> preselected (the link agents paste)
  /raw/<path>        the file itself (iframe/img sources, downloads)
  /view?f=a,b,c      standalone multi-model 3D viewer (STL + 3MF assembly view)
  /api/3mf/<path>    3MF slicer metadata (filament colors, plate summary) as JSON
  /thumb/<path>      the plate cover rendered into a 3MF, when it has one
  /api/tree          flat JSON file list, newest first
  /_viewerlib/<js>   vendored viewer modules (three.js, loaders, controls, gizmo)
  /healthz           200 ok

Env: DROP_ROOT (default /data), DROP_PORT (8484), DROP_BIND (0.0.0.0).
"""
import collections
import http.server
import json
import mimetypes
import os
import threading
import time
import urllib.parse
import zipfile

import threemf

ROOT = os.path.realpath(os.environ.get('DROP_ROOT', '/data'))
PORT = int(os.environ.get('DROP_PORT', '8484'))
BIND = os.environ.get('DROP_BIND', '0.0.0.0')
STATE = os.environ.get('DROP_STATE', '')   # writable dir for opened-history; in-memory if unset
VIEWERLIB = os.path.realpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), 'viewerlib'))

EXCLUDE_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', '.cache',
                '.pytest_cache', 'dist', '.next'}
MAX_FILES = 4000          # newest wins when the walk finds more
MAX_ASSEMBLY = 20         # models in one /view scene, matching the history entry cap
TREE_TTL_SECONDS = 3.0
TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024

mimetypes.add_type('model/stl', '.stl')
mimetypes.add_type('text/markdown', '.md')
mimetypes.add_type('model/3mf', '.3mf')
mimetypes.add_type('application/octet-stream', '.gcode')


def script_json(data):
    """JSON safe to embed inside a <script> block: '<' is escaped so a path containing
    '</script>' cannot break out of the script element (agents control path names)."""
    return json.dumps(data).replace('<', '\\u003c')


def resolve(rel):
    """Map a URL path (already url-decoded) to a real file under ROOT, or None."""
    rel = rel.lstrip('/')
    if not rel or any(part in ('..', '') for part in rel.split('/')):
        return None
    try:
        full = os.path.realpath(os.path.join(ROOT, rel))
    except (OSError, ValueError):     # e.g. an embedded NUL, which lstat rejects
        return None
    if full != ROOT and not full.startswith(ROOT + os.sep):
        return None
    return full


_tree_cache = {'at': 0.0, 'data': None}


def build_tree():
    now = time.monotonic()
    if _tree_cache['data'] is not None and now - _tree_cache['at'] < TREE_TTL_SECONDS:
        return _tree_cache['data']
    files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames
                       if not d.startswith('.') and d not in EXCLUDE_DIRS]
        for name in filenames:
            if name.startswith('.'):
                continue
            full = os.path.join(dirpath, name)
            try:
                st = os.stat(full)
            except OSError:
                continue
            files.append({
                'p': os.path.relpath(full, ROOT).replace(os.sep, '/'),
                'm': int(st.st_mtime),
                'c': int(st.st_ctime),   # when the file landed here (inode change time)
                's': st.st_size,
            })
    files.sort(key=lambda f: -f['m'])
    truncated = len(files) > MAX_FILES
    data = {'files': files[:MAX_FILES], 'truncated': truncated, 'now': int(time.time())}
    _tree_cache['at'] = now
    _tree_cache['data'] = data
    return data


# 3MF slicer metadata, keyed by path and mtime. Reading it touches only the small
# Metadata/*.config members, never the mesh, so it stays cheap even for a large project.
_3mf_lock = threading.Lock()
_3mf_cache = collections.OrderedDict()
THREEMF_CACHE_MAX = 64


def model_info(full):
    """Parsed 3MF sidecar metadata for a file, or None if it is not a readable 3MF."""
    if not full.lower().endswith('.3mf'):
        return None
    try:
        st = os.stat(full)
    except OSError:
        return None
    # size and inode as well as mtime, because a file copied in with its timestamp
    # preserved is a supported way to land content here and would otherwise read stale
    key = (full, st.st_mtime_ns, st.st_size, st.st_ino)
    with _3mf_lock:
        if key in _3mf_cache:
            _3mf_cache.move_to_end(key)
            return _3mf_cache[key]
    try:
        info = threemf.read_3mf(full)
    except Exception:          # a malformed drop must not take the previewer down
        info = None
    with _3mf_lock:
        _3mf_cache[key] = info
        _3mf_cache.move_to_end(key)
        while len(_3mf_cache) > THREEMF_CACHE_MAX:
            _3mf_cache.popitem(last=False)     # evict oldest, rather than flush all
    return info


# Opened-history: shared across devices (the reason it is server-side, not localStorage).
# One JSON file in the state volume, newest first, deduped, capped.
OPENED_CAP = 200
_opened_lock = threading.Lock()
_opened_mem = []


def _opened_path():
    return os.path.join(STATE, 'opened.json') if STATE else None


def load_opened():
    path = _opened_path()
    if not path:
        return list(_opened_mem)
    try:
        with open(path) as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def normalize_opened(p):
    """Validate a history entry: a file path, a folder path (stored with a trailing '/'),
    or a list of file paths (an STL assembly). Returns the normalized entry, or None."""
    if isinstance(p, str):
        full = resolve(p)
        if not full:
            return None
        rel = os.path.relpath(full, ROOT).replace(os.sep, '/')
        if os.path.isfile(full):
            return rel
        if os.path.isdir(full):
            return rel + '/'
        return None
    if isinstance(p, list) and 1 < len(p) <= 20:
        out = []
        for item in p:
            full = resolve(item) if isinstance(item, str) else None
            if not full or not os.path.isfile(full):
                return None
            out.append(os.path.relpath(full, ROOT).replace(os.sep, '/'))
        return out
    return None


def record_opened(rel):
    with _opened_lock:
        entries = [e for e in load_opened() if e.get('p') != rel]
        entries.insert(0, {'p': rel, 't': int(time.time())})
        entries = entries[:OPENED_CAP]
        path = _opened_path()
        if not path:
            _opened_mem[:] = entries
            return
        tmp = path + '.tmp'
        with open(tmp, 'w') as fh:
            json.dump(entries, fh)
        os.replace(tmp, path)


VIEWER_HTML = r"""<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>3D &mdash; %TITLE%</title>
<style>
:root{--bg:#131417;--panel:rgba(22,23,26,0.88);--line:rgba(255,255,255,0.10);
      --fg:#ececec;--dim:#9a9a9a;--faint:#6f6f6f;--gold:#c4a054;--acc:#e44d4d}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);overflow:hidden;
  font:13px/1.5 "Open Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
canvas{display:block;touch-action:none}
.pad{position:fixed;z-index:2;background:var(--panel);border:1px solid var(--line);
     border-radius:6px;padding:8px 11px;backdrop-filter:blur(7px);max-width:min(46vw,340px)}
#legend{top:10px;left:10px;max-height:min(46vh,420px);overflow-y:auto;overscroll-behavior:contain}
#legend .m{display:flex;align-items:center;gap:7px;line-height:1.75;white-space:nowrap}
#legend .sw{width:10px;height:10px;border-radius:2px;flex:0 0 auto;
            box-shadow:0 0 0 1px rgba(0,0,0,0.5) inset}
#legend .nm{overflow:hidden;text-overflow:ellipsis}
#legend .ct{color:var(--faint);font-size:11px;flex:0 0 auto}
#dims{bottom:10px;left:10px;font-variant-numeric:tabular-nums}
#warn{top:10px;left:50%;transform:translateX(-50%);color:var(--acc);
      border-color:rgba(228,77,77,0.5)}
#dims b{color:var(--gold);font-weight:700;letter-spacing:0.02em}
#dims .sub{color:var(--faint);font-size:11px;margin-top:2px}
#info{top:10px;right:10px;line-height:1.7}
#info .r{display:flex;gap:12px;justify-content:space-between}
#info .k{color:var(--faint)}
#info .v{color:var(--fg);text-align:right}
#info .hd{color:var(--gold);font-weight:700;margin-bottom:3px}
#info .fil{display:flex;align-items:center;gap:6px}
#info .sw{width:9px;height:9px;border-radius:2px;box-shadow:0 0 0 1px rgba(0,0,0,0.5) inset}
.tag{display:inline-block;font-size:10px;border-radius:3px;padding:0 5px;margin-top:5px;
     border:1px solid var(--line);color:var(--dim)}
.tag.on{color:var(--gold);border-color:rgba(196,160,84,0.45)}
#hint{position:fixed;z-index:2;bottom:12px;left:50%;transform:translateX(-50%);
      color:var(--faint);font-size:11px;text-align:center;pointer-events:none;
      max-width:min(70vw,460px)}
#msg{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
     color:var(--dim);z-index:3;pointer-events:none;text-align:center;padding:20px}
#cover{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:1;
       opacity:0;transition:opacity 400ms ease;pointer-events:none}
#cover img{max-width:62%;max-height:62%;border-radius:6px;filter:saturate(0.55) blur(0.4px);opacity:0.5}
@media (max-width:620px){
  .pad{max-width:58vw;padding:6px 8px;font-size:12px}
  #info{line-height:1.45}
  #info .hd,#info .r:not(.keep){display:none}   /* keep the tag and the headline rows */
  #hint{display:none}
  #legend{max-height:34vh}
}
@media (prefers-reduced-motion:reduce){#cover{transition:none}}
[hidden]{display:none!important}
</style>
<div id="cover"></div>
<div class="pad" id="legend" hidden></div>
<div class="pad" id="dims" hidden></div>
<div class="pad" id="info" hidden></div>
<div id="hint">drag orbit &middot; scroll zoom &middot; right-drag pan &middot; click a cube face</div>
<div id="msg">loading&hellip;</div>
<script type="importmap">
{"imports":{"three":"/_viewerlib/three.module.js"}}
</script>
<script type="module">
import * as THREE from 'three';
import {STLLoader} from '/_viewerlib/loaders/STLLoader.js';
import {ThreeMFLoader} from '/_viewerlib/loaders/3MFLoader.js';
import CameraControls from '/_viewerlib/camera-controls.module.min.js';
import {ViewportGizmo} from '/_viewerlib/three-viewport-gizmo.js';

const FILES = %FILES%;
const $ = s => document.querySelector(s);
const base = p => p.split('/').pop();
const ext = p => { const n = base(p), i = n.lastIndexOf('.');
                   return i < 0 ? '' : n.slice(i + 1).toLowerCase(); };
const enc = p => p.split('/').map(encodeURIComponent).join('/');
const esc = s => String(s).replace(/[&<>"]/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// Colours land inside a CSS background, so anything that is not a plain hex triple
// is dropped rather than escaped into a style attribute.
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const safeColor = c => (typeof c === 'string' && HEX6.test(c)) ? c : '#888888';

// Z is up: print beds are XY and every model here is authored that way. Setting the
// default before anything is constructed also tells the gizmo to label its cube Z-up.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
CameraControls.install({THREE});

// Fallback palette, from the site's shared/theme.css family. Used only where a file
// carries no color of its own: a 3MF names its real filament colors and those win.
const COLS = ['#c4a054', '#c62828', '#9a9a9a', '#6d8bb0', '#d9c9a3', '#7a4a3a'];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16171a);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 100000);
camera.up.set(0, 0, 1);
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// Intensities are in three's physical units (r155 dropped the legacy light scaling).
scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1a20, 2.2));
const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(1, -1.4, 2);
const fill = new THREE.DirectionalLight(0xffffff, 0.9); fill.position.set(-1.6, 1, 0.6);
const rim = new THREE.DirectionalLight(0xffd9a0, 0.6); rim.position.set(0, 1.5, -1);
scene.add(key, fill, rim);

const controls = new CameraControls(camera, renderer.domElement);
const A = CameraControls.ACTION;
// Bambu Studio / Orca bindings, because that is the muscle memory these models come from.
controls.mouseButtons.left = A.ROTATE;
controls.mouseButtons.middle = A.TRUCK;
controls.mouseButtons.right = A.TRUCK;
controls.mouseButtons.wheel = A.DOLLY;
controls.touches.one = A.TOUCH_ROTATE;
controls.touches.two = A.TOUCH_DOLLY_TRUCK;
controls.touches.three = A.TOUCH_TRUCK;
controls.dollyToCursor = true;
controls.smoothTime = 0.12;
controls.draggingSmoothTime = 0.06;
controls.updateCameraUp();

const gizmo = new ViewportGizmo(camera, renderer, {
  type: 'cube', size: 96, placement: 'bottom-right', offset: {bottom: 12, right: 12},
  id: 'navcube',
  font: {family: '"Open Sans",system-ui,sans-serif', weight: 600},
  background: {color: 0x1c1d21, opacity: 0.92,
               hover: {color: 0x24252b, opacity: 1}},
  edges: {color: 0x2c2d33, opacity: 1},
  corners: {color: 0x2c2d33, hover: {color: 0xc4a054}},
  x: {label: 'R', color: 0x26272d, labelColor: 0xd8d8d8, hover: {color: 0xc4a054, labelColor: 0x16171a}},
  nx: {label: 'L', color: 0x26272d, labelColor: 0xd8d8d8, hover: {color: 0xc4a054, labelColor: 0x16171a}},
  y: {label: 'BK', color: 0x26272d, labelColor: 0xd8d8d8, hover: {color: 0xc4a054, labelColor: 0x16171a}},
  ny: {label: 'FR', color: 0x26272d, labelColor: 0xd8d8d8, hover: {color: 0xc4a054, labelColor: 0x16171a}},
  z: {label: 'TOP', color: 0x26272d, labelColor: 0xd8d8d8, hover: {color: 0xc4a054, labelColor: 0x16171a}},
  nz: {label: 'BOT', color: 0x26272d, labelColor: 0xd8d8d8, hover: {color: 0xc4a054, labelColor: 0x16171a}},
});
// The gizmo drives the camera directly, so hand the wheel over for the length of a
// face-snap and hand back the resulting position, rather than letting both fight per frame.
const TARGET = new THREE.Vector3();
gizmo.addEventListener('start', () => { controls.enabled = false; });
gizmo.addEventListener('change', () => {
  controls.setPosition(camera.position.x, camera.position.y, camera.position.z, false);
});
gizmo.addEventListener('end', () => { controls.enabled = true; });
// The widget is a disc but only the cube inside it is pickable, so a click on the
// corner of the disc opens with "start" and never closes. Re-enable on any pointer
// release instead of trusting that "end" arrives, or navigation dies for good.
for (const ev of ['pointerup', 'pointercancel']){
  addEventListener(ev, () => requestAnimationFrame(() => {
    if (!gizmo.animating) controls.enabled = true;
  }), true);
}

function syncGizmo(){
  controls.getTarget(TARGET);
  gizmo.target = TARGET;
  gizmo.update(false);          // re-aim the cube at the camera, without driving it back
}

// ---- loading -------------------------------------------------------------------

function loadSTL(url){
  return new STLLoader().loadAsync(url).then(g => {
    const m = new THREE.Mesh(g, null);
    const o = new THREE.Group(); o.add(m); return o;
  });
}

function loadModel(path){
  const url = '/raw/' + enc(path);
  if (ext(path) === '3mf'){
    return Promise.all([
      new ThreeMFLoader().loadAsync(url),
      // the slicer metadata the mesh loader cannot see: real filament colors and the
      // print summary, read from Metadata/*.config server-side
      fetch('/api/3mf/' + enc(path)).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([group, info]) => ({group, info}));
  }
  return loadSTL(url).then(group => ({group, info: null}));
}

const STD = c => new THREE.MeshStandardMaterial({
  color: new THREE.Color(c), roughness: 0.62, metalness: 0.04,
});

const parts = [];   // {name, color, tris} for the legend

function colorize(group, info, fileIndex, label){
  // A 3MF's build items come back as group children in document order, which is the
  // same order the server reports them in, so item i describes child i.
  const kids = group.children;
  // items[i] describes kids[i] only if both describe the same build. On any mismatch
  // the pairing is meaningless and would paint confident, wrong filament colors, so
  // fall back to the palette for the whole file instead.
  let items = (info && info.items) || [];
  if (items.length !== kids.length) items = [];
  let tris = 0;
  kids.forEach((child, i) => {
    const it = items[i] || {};
    const col = it.color || COLS[parts.length % COLS.length];
    const mat = STD(col);
    child.traverse(o => { if (o.isMesh){
      o.material = mat;
      const g = o.geometry;
      if (!g.attributes.normal) g.computeVertexNormals();
      tris += (g.index ? g.index.count : (g.attributes.position?.count || 0)) / 3;
    }});
    parts.push({name: it.name || (kids.length > 1 ? label + ' #' + (i + 1) : label),
                named: !!it.name, color: col});
  });
  return tris;
}

function fmtTime(s){
  if (!s && s !== 0) return null;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + 'm';
}
const fmtN = (n, d = 1) => n.toLocaleString(undefined,
  {minimumFractionDigits: d, maximumFractionDigits: d});

function renderLegend(){
  if (parts.length < 2 && !(parts[0] && parts[0].named)) return;
  $('#legend').innerHTML = parts.map(p =>
    `<div class="m"><span class="sw" style="background:${safeColor(p.color)}"></span>
     <span class="nm" title="${esc(p.name)}">${esc(p.name)}</span></div>`).join('');
  $('#legend').hidden = false;
}

function warn(text){
  // A part missing from an assembly must be visible: the remaining parts otherwise
  // look like the whole model, with a bounding box to match.
  const el = document.createElement('div');
  el.className = 'pad'; el.id = 'warn'; el.textContent = text;
  document.body.appendChild(el);
}

function renderDims(box, tris){
  const s = box.getSize(new THREE.Vector3());
  $('#dims').innerHTML =
    `<b>${fmtN(s.x)} &times; ${fmtN(s.y)} &times; ${fmtN(s.z)} mm</b>
     <div class="sub">${Math.round(tris).toLocaleString()} triangles</div>`;
  $('#dims').hidden = false;
}

function renderInfo(info){
  if (!info) return;
  // Every plate's objects are in the scene, so the panel totals every plate. Reporting
  // plate 1 alone would caption the whole view with part of it.
  const plates = info.plates || [];
  const rows = [];
  const add = (k, v, keep) => { if (v) rows.push(
    `<div class="r${keep ? ' keep' : ''}"><span class="k">${k}</span>` +
    `<span class="v">${v}</span></div>`); };
  const sum = f => plates.reduce((a, p) => a + (f(p) || 0), 0);
  if (plates.length){
    const secs = sum(p => p.seconds), grams = sum(p => p.grams);
    const many = plates.length > 1;
    add(many ? 'print time, all plates' : 'print time', fmtTime(secs), true);
    add(many ? 'filament, all plates' : 'filament', grams ? fmtN(grams) + ' g' : null, true);
    const spools = new Map();          // one row per filament, merged across plates
    plates.forEach(p => (p.filaments || []).forEach(f => {
      const k = (f.type || '') + '|' + (f.color || '');
      const cur = spools.get(k) || {type: f.type, color: f.color, used_m: 0};
      cur.used_m += f.used_m || 0;
      spools.set(k, cur);
    }));
    if (spools.size) rows.push(
      `<div class="r"><span class="k">spools</span><span class="v">` +
      [...spools.values()].map(f =>
        `<span class="fil"><span class="sw" style="background:${safeColor(f.color)}"></span>` +
        `${esc(f.type || '')}${f.used_m ? ' &middot; ' + fmtN(f.used_m) + ' m' : ''}</span>`
      ).join('') + `</span></div>`);
    if (plates.some(p => p.support)) add('supports', 'on');
  }
  add('printer', info.printer ? esc(info.printer) : null);
  add('layer', info.layer ? info.layer + ' mm' : null);
  if (plates.length > 1) add('plates', plates.length);
  if (!rows.length) return;
  const tag = info.sliced
    ? '<span class="tag on">sliced &middot; g-code embedded</span>'
    : '<span class="tag">geometry only &middot; not sliced</span>';
  $('#info').innerHTML = '<div class="hd">print</div>' + rows.join('') + tag;
  $('#info').hidden = false;
}

// Three-quarter view from the front-right and above, the angle slicers open on.
// The distance is solved rather than handed to fitToBox, which re-aims the camera
// down an axis and loses the angle.
const DIR = new THREE.Vector3(0.62, -0.78, 0.55).normalize();

function frame(box){
  const c = box.getCenter(new THREE.Vector3());
  const r = (box.getSize(new THREE.Vector3()).length() / 2) || 50;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const d = 1.18 * Math.max(r / Math.sin(vFov / 2), r / Math.sin(hFov / 2));
  controls.setTarget(c.x, c.y, c.z, false);
  controls.setPosition(c.x + DIR.x * d, c.y + DIR.y * d, c.z + DIR.z * d, false);
  camera.near = Math.max(d / 1000, 0.02);
  controls.minDistance = Math.max(r / 50, camera.near * 2);
  controls.maxDistance = d * 8;
  camera.far = d * 20;
  camera.updateProjectionMatrix();
  syncGizmo();
}

function addGround(box){
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y) * 2.2 || 200;
  const step = Math.pow(10, Math.round(Math.log10(span / 12)));
  const grid = new THREE.GridHelper(Math.ceil(span / step) * step,
                                    Math.ceil(span / step), 0x3a3b42, 0x25262b);
  grid.rotation.x = Math.PI / 2;                 // GridHelper is XZ; the bed is XY
  const c = box.getCenter(new THREE.Vector3());
  grid.position.set(c.x, c.y, box.min.z);
  grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(grid);
}

// A rendered plate cover, when the slicer wrote one, as something to look at while a
// large mesh downloads and parses. Most headless slices carry none.
if (FILES.length === 1 && ext(FILES[0]) === '3mf'){
  const img = new Image();
  img.onload = () => { const c = $('#cover');
    if (c.dataset.done !== '1'){ c.appendChild(img); c.style.opacity = '1'; } };
  img.src = '/thumb/' + enc(FILES[0]);
}

// A pasted /view link counts as history. Embedded as the preview iframe it does not:
// the app records deliberate opens itself, and would otherwise log its own auto-select
// on load and log a real click twice.
if (window.top === window)
  fetch('/api/opened', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({p: FILES.length > 1 ? FILES : FILES[0]})}).catch(() => {});

Promise.all(FILES.map(f => loadModel(f).catch(e => { console.error(f, e); return null; })))
  .then(loaded => {
    const box = new THREE.Box3();
    let tris = 0, ok = 0, info1 = null;
    loaded.forEach((res, i) => {
      if (!res) return;
      ok++;
      if (!info1) info1 = res.info;
      tris += colorize(res.group, res.info, i, base(FILES[i]));
      scene.add(res.group);
      box.expandByObject(res.group);
    });
    const cover = $('#cover'); cover.dataset.done = '1'; cover.style.opacity = '0';
    const finite = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
    if (!ok || box.isEmpty() || !finite(box.min) || !finite(box.max)){
      // NaN vertices compare false everywhere, so isEmpty() alone lets them through
      // and they then poison the camera into rendering nothing at all
      $('#msg').textContent = 'could not read ' +
        (FILES.length > 1 ? 'these models' : base(FILES[0]));
      return;
    }
    $('#msg').hidden = true;
    if (ok < FILES.length) warn((FILES.length - ok) + ' of ' + FILES.length +
                                ' failed to load');
    addGround(box);
    frame(box);
    renderDims(box, tris);
    renderLegend();
    if (FILES.length === 1) renderInfo(info1);
    invalidate();
  });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  gizmo.update();
});

const timer = new THREE.Timer();
// Redraw on demand rather than at 60 fps forever: these scenes are static between
// interactions, and the viewer sits in an always-open iframe.
let dirty = true;
const invalidate = () => { dirty = true; };
controls.addEventListener('update', invalidate);
gizmo.addEventListener('change', invalidate);
addEventListener('resize', invalidate);
// the cube highlights faces on hover, which is a redraw with no camera movement
const cubeEl = document.getElementById('navcube');
if (cubeEl) for (const ev of ['pointermove', 'pointerleave', 'pointerdown'])
  cubeEl.addEventListener(ev, invalidate);

(function loop(){
  requestAnimationFrame(loop);
  timer.update();
  const moved = controls.update(timer.getDelta());
  if (moved || gizmo.animating) syncGizmo();
  if (!(moved || gizmo.animating || dirty)) return;   // a still scene costs nothing
  dirty = false;
  renderer.render(scene, camera);
  gizmo.render();
})();
</script>"""


APP_HTML = r'''<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>drop</title>
<style>
/* Tokens mirror shared/theme.css (the site's single source of truth for the look):
   neutral dark base, white text, maroon interactive accent, gold trim. */
:root{--bg:#131417;--panel:#16171a;--line:rgba(255,255,255,0.08);--fg:#ececec;
      --dim:#9a9a9a;--faint:#6f6f6f;--acc:#c62828;--acc-soft:#e44d4d;
      --gold:rgba(196,160,84,0.28);--gold-text:#c4a054;--sel:#1d1e23;--acc-dark:#9e1f1f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);height:100vh;overflow:hidden;
     font:14px/1.5 "Open Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
#app{display:flex;height:100vh}
#side{width:340px;min-width:240px;border-right:1px solid var(--gold);display:flex;
      flex-direction:column;background:var(--panel)}
#side header{padding:12px 14px 8px}
#side h1{font-size:15px;margin:0 0 8px;color:var(--fg);font-weight:700}
#side h1 small{color:var(--faint);font-weight:400;margin-left:8px}
#q{width:100%;background:var(--bg);border:1px solid var(--line);border-radius:4px;
   color:var(--fg);padding:6px 9px;font-size:13px;font-family:inherit;outline:none}
#q:focus{border-color:var(--gold-text)}
#tabs{display:flex;gap:4px;margin-top:8px}
#tabs button{flex:1;background:none;border:1px solid var(--line);border-radius:4px;
  color:var(--dim);padding:3px 0;font-size:12px;font-family:inherit;cursor:pointer;
  transition:background-color 150ms ease,color 150ms ease,border-color 150ms ease}
#tabs button:hover{background:rgba(255,255,255,0.07);color:#fff}
#tabs button.on{background:var(--sel);border-color:var(--acc);color:var(--acc-soft);font-weight:700}
.row .dir{color:var(--faint);font-size:11px;overflow:hidden;text-overflow:ellipsis;
  max-width:38%;flex-shrink:1}
#list{flex:1;overflow-y:auto;padding:4px 0 60px}
.gh{padding:8px 14px 3px;color:var(--dim);font-size:12px;font-weight:700;cursor:pointer;
    position:sticky;top:0;background:var(--panel);z-index:1;white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
.gh{transition:color 150ms ease}
.gh:hover{color:var(--gold-text)}
.row{display:flex;align-items:center;gap:8px;padding:4px 14px 4px 20px;cursor:pointer;
     white-space:nowrap;transition:background-color 150ms ease}
.row:hover{background:var(--sel)}
.row.on{background:var(--sel);box-shadow:inset 2px 0 0 var(--acc)}
.row .nm{flex:1;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.row .tm{color:var(--faint);font-size:11px;flex-shrink:0}
.row input{accent-color:var(--acc);margin:0;flex-shrink:0}
.badge{font-size:10px;color:var(--gold-text);border:1px solid var(--gold);border-radius:3px;
       padding:0 4px;flex-shrink:0}
#foot{padding:8px 14px;border-top:1px solid var(--line);color:var(--faint);font-size:11px}
#main{flex:1;display:flex;flex-direction:column;min-width:0}
#phead{display:flex;align-items:center;gap:12px;padding:9px 16px;border-bottom:1px solid var(--line)}
#pname{font-weight:700;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pmeta{color:var(--faint);font-size:12px;flex-shrink:0}
#phead .sp{flex:1}
#phead a,#phead button{color:var(--acc-soft);background:none;border:1px solid var(--line);
  border-radius:4px;padding:3px 10px;font-size:12px;font-family:inherit;cursor:pointer;
  text-decoration:none;transition:background-color 150ms ease,color 150ms ease,
  border-color 150ms ease}
#phead a:hover,#phead button:hover{background:rgba(255,255,255,0.07);color:#fff;
  border-color:var(--gold)}
#pane{flex:1;min-height:0;position:relative;overflow:auto}
#pane iframe{width:100%;height:100%;border:0;display:block;background:#fff}
#pane iframe.dark{background:var(--bg)}
#pane .imgwrap{display:flex;align-items:center;justify-content:center;height:100%;padding:16px}
#pane .imgwrap img{max-width:100%;max-height:100%;border-radius:3px;background:#eee}
#pane video{width:100%;height:100%;background:#000}
#pane pre{margin:0;padding:16px 20px;font:12.5px/1.55 ui-monospace,monospace;
          white-space:pre-wrap;word-break:break-word;color:var(--fg)}
#pane .empty{display:flex;height:100%;align-items:center;justify-content:center;
             color:var(--faint);flex-direction:column;gap:8px;text-align:center;padding:20px}
#pane .md{max-width:840px;margin:0 auto;padding:22px 26px;line-height:1.65}
#pane .md h1,#pane .md h2,#pane .md h3{color:var(--fg);line-height:1.3}
#pane .md h1{font-size:22px}#pane .md h2{font-size:18px}#pane .md h3{font-size:15px}
#pane .md code{background:var(--panel);border:1px solid var(--line);border-radius:3px;
               padding:1px 5px;font:12.5px ui-monospace,monospace}
#pane .md pre{background:var(--panel);border:1px solid var(--line);border-radius:5px;
              padding:12px 14px;overflow-x:auto}
#pane .md pre code{background:none;border:0;padding:0}
#pane .md a{color:var(--acc-soft)}
#pane .md li{margin:2px 0}
#pane .md table{border-collapse:collapse;margin:10px 0;display:block;overflow-x:auto}
#pane .md th,#pane .md td{border:1px solid var(--line);padding:4px 10px;text-align:left}
#pane .md th{color:var(--gold-text);background:var(--panel)}
#pane .md blockquote{border-left:3px solid var(--line);margin:8px 0;padding:2px 14px;
                     color:var(--dim)}
#pane .md img{max-width:100%}
#pane .md hr{border:0;border-top:1px solid var(--line)}
#pane .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));
            gap:14px;padding:16px}
#pane .grid figure{margin:0;background:var(--panel);border:1px solid var(--line);
                   border-radius:4px;padding:8px;cursor:pointer;
                   transition:transform 150ms ease,box-shadow 150ms ease,border-color 150ms ease}
#pane .grid figure:hover{border-color:var(--gold);transform:translateY(-2px);
                   box-shadow:0 7px 14px rgba(0,0,0,0.45)}
#pane .grid img{width:100%;height:auto;border-radius:2px;background:#eee}
#pane .grid figcaption{font-size:12px;margin-top:6px;color:var(--dim);overflow:hidden;
                       text-overflow:ellipsis;white-space:nowrap}
#pane .grid figcaption span{float:right;color:var(--faint)}
#pane .filelist{padding:8px 16px}
#pane .filelist a{display:block;color:var(--acc-soft);padding:3px 0;text-decoration:none;font-size:13px}
#stlbar{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);background:var(--panel);
        border:1px solid var(--gold);border-radius:6px;padding:8px 14px;display:flex;gap:12px;
        align-items:center;z-index:5;box-shadow:0 10px 30px -16px rgba(0,0,0,.75)}
#stlbar button{background:var(--acc);color:#fff;border:0;border-radius:4px;
               padding:4px 12px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;
               transition:background-color 150ms ease,color 150ms ease}
#stlbar button:not(.x):hover{background:var(--acc-dark)}
#stlbar .x{background:none;color:var(--dim);border:1px solid var(--line)}
#stlbar .x:hover{background:rgba(255,255,255,0.07);color:#fff}
button.big,a.big{background:var(--acc);color:#fff;border:0;border-radius:4px;
           padding:6px 14px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;
           display:inline-block;transition:background-color 150ms ease}
button.big:hover,a.big:hover{background:var(--acc-dark)}

/* Gold iron-frame + gleam, copied verbatim from shared/theme.css (this page has no
   build step to import it; regenerate alongside theme.css if the frame art changes). */
:root{
--f-tl: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAeCAYAAADZ7LXbAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAFE0lEQVRIibWWaWyURRjHfzPvu+/uUkoLtos90FLoBXhxiGIQlWAFI0SN8QADRgKxGhIxCtGo8UzUxvsWUDzwAkW8OOQqkYDh0EAbcBuKtHR7bXcXaHf3PWb8gOARExHX/6f5Ms9v5nn+zzwjtNb83xInFosfnxYfN+5i0ZPoUqOvre0PdN84aYjoE/QbDQdiav+hbgUwcezZuaYhSaZc/H4TKSSgMaXAVaC0wkm7uBqkACkFJkAs/IUShiUAdm9bDaCfXVjNnDsXcizRhpQSO92D9lyUBikknudg+vyYpv/kiTUKpTw818a20ySPJVi+cg0iXPecDhVXkFM6hbtuGgWGIJVyeeXN92jau5bKCfdQu6Ca/LxcGvY3s7ouzHVXDqestIDBg0uofXU5K9aFAfjitdsQhkEgYBHKD2EFghjSQMTCnyeC/Yf0O7h3DfmFZTh2EiklweyBZA+6jE9fupXKyio21W3lUEuU/Lxs7ntmLeeVh9j0zRKsrDxCpeOZd+uFTLt6ApHWViLtUcqGnM2AAQOw0zZmrC2sWpoaiLS10hZppaOjE9Mn2P1TEzdMKuf8kaM5q3IijeGf2R+OYEpBw8aneXnRxyx79w2mz6rhcP0qAtmF7Nz8AbbtAoL7nvyQURVFSOP3wuth5SFeeWQ6P+7ZxxWXXkRXNEpB0SA62yN0dEW54c6lbVKKw0rpo0ueuDZ/6vUzhhumX+/avlZvqNuF5ffpw5GYG/Ab8y8YUfruW+9vEf6Aj3QqrQG6H5h7iT7yy3qdaFqjaxdU64M/vKofrpmg170zV0cblunVi2Y7wJTcfkE/CAkMBBYDHwGPATcBI4EQkAMEAOuEIeTlowvF/Lvv4buv3ydncDWR9jhd7S1kZVn4pCSd7qW0rFw+XDO+MH4kZYNWQDuI2SBuBh78DbYL6AASQAqwT0DMnH5Bw/XSXFfzNp+8OINRYy6ifs+PzJk7D63B8Fn4g7mysqx4/sypw5ctXbW397cMn3IXy0hHr9LK44X7J1NVNYzi8suIdseJtjWSTsZJdB4kp/hCJk+bOXjkeSUDTzXwH2Wmemzl2mn652bz/dbtNDaGmfPgZ9pxlh9+dN7l2z3X7Zxc3XR+44FmY2HtuvRpQXo8D9PyU/9zC8rTbNkexnHUTuCqh17cmAhapj7Y0i06kp5IJm33dCASjr83X65vID8vm1HnDAJoBhED3KTtektX1bvfrtvn/Js6/ElFob7x5h2L9b2zxmpAN2x8WtcuqG4F0fe0Av7dTbKChhSGpKpiEGNHFPL64k+47fY7zgQ9JmOQjljKU65NVcVQVq98k4rSAkyrjy4K9Q1kDJKXG9Q+f5CnXl6BlZXH9Fk17Pj+K+14KpUxiGX4MH19WLkhzLCRVwKwoW7nvlTK/SljEFAnp+Mt15xDILuQISUF75SXDIhlCmK6SkmAJ+dP5IoJY9m95UO27WrUO+rbMjb8peOC1grTMPhuwzYONbfQ1nlM/PPWU5eplKeUctlT38JRxyEraPFt3QENQpx28/0VkuxJazedxLRM+lsmzy/diqMUf/jI/GfJWFKRtpNE40eZdOlwJo0ryVjwkxDLRPhMH6s2NdEZTYAHwNCCvD6Zg/h8Umrg7hljCJ2RQ6InBZAb6erJnLviR9I62XuE8RdXUVRcyJSJ5wI4mQIAmIA6Go8xtKwM13FQrgPgZtJdEmDlN5vx+4NEu7vp7bXheGUyZq9fAeJNNuryzCpfAAAAAElFTkSuQmCC");
--f-tr: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAeCAYAAADZ7LXbAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAFD0lEQVRIibWUaWxUVRiGn3vn3lmYTqfL0NIFUkpLWUpKiqYIAZHYVnCBCMYVWZVYYoyIUcGIif4Ag0aJEGIkigruAqKsAQRCBVIQhJZCoQULlM60naF1OnNn7j3HP2hK3LAZnz/fj5Oc5zs57/cpUkr+b5SpEwuFEBIhQVNAd2ioioqmgikkoCCkwDBMXE4N0xLsPnwxBFA0IE0dlp+qdkcM6/Nd5yWQVrNxUdDt9anV1T/KuS9vTgHQSob0U6ZPrcSV5MVud2DT7KiqDQX1j05M08CMG9hsOkIKVIVUxaZhd7gRQpDk7UfZqmUsXLZDdkXiFJSUMC2vhPsfnCNSC6eoypl9K6QlLGLRCP6An2g0xqn6Jha/tRuAaeWFLKqaTlPTBRoaW/hmZy13jS9kWFF/Am0hFi3fQf2+NxlYXMGCJ2fgdGpgSd797CjXGrfiv3QG5eedr0tN07h8+RIN5y/SEQxz58TRbP5+Hys/PoK/8QCxcBsTJs/hxFk/bzxfQaCtiwG56UwYP4b6+tM88PTHdDX/QKSrFSEEut1F4EoDecWVRILnO21Wd9ur1YdO8tGmakYVDyA324fH7ebhOS/xzLx7EGaUDevW4HSprFv5LI3nmwi0dTGyeCCjy2fj0g2uNjdy5uRh4tEATefOEu4M0BFsJ9bVgmWEIsqY4owkh9OhGNE4Tzw2Tv50qvHxqGG9lZOVqsWMuDJxfCmlZRWKZRrKt19/UjtnycaAqioeIWTOl6tm9svwpdM3M4uWy8340tPZs/8QI0cMYcHS9dSd9QMoPZNmB5yAF8gASoGHgNeAz4C1QCYoakqyywFM3v7+vHh73Qa568P5cmnV7fLCkdVyxQuV8lrTDtl5cbdcMn+sBDq0HpLY9Rq9Xv3AsetJv96NlCAJdUZjS6vGZecXDlYNoxtdVXG77bS1XqKlNYR3YCXfrJ7Nwmefo/pok9JT8g/cOLEz7xvuGlKYuzA9M1/VnR5Kbstk5BjYv2czVfNnUFZayP1VH9BaW4E32WW7ScmNlJbkZU6aMnNgUsYwWk5vQ3f0IdzZRntHiNzBE+j+tZN3Fk9CCosWf7foleTFFbuM9DTvyYL8/ta2HQeP2zSt7ysr95bpupqT4vUorf4OUlM8mDGDaDjWO0kkEmtZv/Xo2AzXcfnF9jMyEjMVwBuPi+1fbTl8S3amF9WmUDHJQdiyeuyO/4SU23bVx9d9W2tGYqYFmKAEgeZRI/rT1+dhy+46hBS9u/7vUZJWvFB5pW7vGxKQz88qk801a2VORlKoly/5K+Sts+c+1W/N2i8oK85maFF/FJuK22VTEybJyUhyavY+sig/i+2b3mNoUQHCjOEPRq2ESeKWiNYc/E4+OqsKu9vH8ne/Rne48KW4ZMIk0ah5Ys/+o/UAw0or2LSnAU3vg92m9zZdf2ZwXlpwUF7Wh05PNo/cO6LHibjZtfLv1NRelYeOnZNDD3zKlLtvx5PkBMAUQk2YBOBq4Ffll+ZLNDRewW7XkFIQNyGBEkXZtr9R3jG6gJq6Zjy6jhAmQlgigXMCcSF4e101qW4Xml3DNCJEwkbi0vU75WPyKB8/nPZQF0YsQjAiEpeuLF8fgAIsCLRfY1CuD13TsWskLl0tbWEJpFwLR8lI99I3LRkJ6Lqa2HQBcW+yk5zcbFQg0t1JqDOhf6IogGlEYkjLJDklha5QECCh6VIAyx/oJmZaOBwuNm3dB8BvifQzdA0+wk4AAAAASUVORK5CYII=");
--f-bl: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAeCAYAAADZ7LXbAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAE9ElEQVRIia3Wa2xURRTA8f/MvXvvbh/Lbh/bBy3G0pbaig9KsLYWShFbohSIiviKJibECBGjUXx8sSpoSIGQCCYIPhAwGESJDwSCSJFEBIuKYitYGqHbUrYta9nu6+4dP4D4Vcw9yWSSSWZ+JzlnJgMw9MLCOtV1oE3t37pEzW0oVcB6EAKHQgK0NNcTj0fJzMwkGkkAiMvDkdAB/FnZhAb6SaUsArlpABqgnEQkAv4804vLMDA9xuV15Rzi85rCk+blyLE/0HVJ+K8YgMspAEAmk7YtgNWbj1A0Npsx6W6ACwU56c4VPmGhklaSloZryc0ec6kacKovNOqUge73SEzDQ7Yvk73tv/L14R7HDv8npCfdFLrpwUpYDEeiPPVILS4pnUWk1KSUOhOriphcWUxhQQ6zppYIR7vLpYMQEiuV4vbGGlTKJj83wzEAQOpS2gAvrtrHzi8OcHP9/dRMKhWTq/KdfFbklay3fnac2EiQP3r6Hv29Z8jvGJJIJbGSo8xtLONExx4AGqdWV7jd+o2OIaELUZGMR1m6+G4SkRBb3lvH5Lq7hEuTbseQgN+tSd3gt65TNM9dSFd3H1ZiVPQOXIw5hkSiKVulbH7rOsPhX4I8/th83t34Vj+II04hlI7zDQV/3qQqr/WpFc/eoVYtbVLADhCO3UgdQArJ7BmVnA+NEDwXBigG5QfCHkNX85sniIFoSuza22X9n0uqp2saViJOVXkRo9E4tVMq+GhvZ3Uyaf/4ypPTD6cs6/ysprqbTnWf0b759vTcaDQevGrEnW5I3TAZvjBC4/R6yie1sD48IqbeVleU7s0pSsZHKbhuFhUTT8TeGAqbS179/GoN9IJAmhRSY8nyXXyUn01ahpfsLB/Z+aUoBWneAOGz37Nn18enO37qOXfVAqAVZHueW3BPi7umMo17Fm/ClRqkdspEtu/4BD0xSKY3nfBQ0N7ffvSlNZt/+P7frUL81x+N3H80qFatXsntdz5E+PRuCvJ85OQVEYkkSNo2pplG98nf7dZ1B4M+r9u43HV5oDaA+hB4FVgATAICwBjADRhX0rk8q8ryAGtbH+TH4500Tq0hNDhIwdhizp/rYyA0yL2L3u+XUvTathp5Z9m83Ja7H6rSdFN1HN6jvm7vwDBdqrdv2HKb2tM3X1+y6e3NB4XpdhGPxZXoPrhiOBJN+vr6gxgug4GB8+guwbGfTtPZPcDylxcxrmIGX25rY1/7cUquyaG5eQZvbthG1fhCHnz0CQDcmYX8cGALZ3uDDA7/xdvbDlE9YSxSA92fXyYL/eNx/bKb3MIykokoUkpmzs4js7iB+S1HiY1GONsXwuMxsGxF5fTnuLE8wLLWVlweP4GSep58eApz7pzGye4gWf50Vrx4P1lZWSTiCfRQX483oJlUNDzL4gXVoAliMYu16z+g88BKKqY9Q9vSJnJzfEhtiC07j9G6uIGykgI6jx+ibd12ItEkr68/RGaGmxuqSnC7DXJzcjDcHjIyvJdqMnxypy00QwAc++4rpj+whlXPN7Fw0fNcDPcjpSQRj6BSFra69EKkUkl0l4mum1e6SGFj2ylSVoJEIk70Ypjtn+7+97+78bU5F2prbxWRcMiePK/NDwzdN3O8SPOY2onuYbvrzyEbYMYt1/h0TRKNWZimjhQSUOhSYNlgK5tk3MJSIAVIKfgbkCvvphjQMf8AAAAASUVORK5CYII=");
--f-br: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABkAAAAeCAYAAADZ7LXbAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAE5klEQVRIia2VWWxUVRjHf+fcO/fOdJ3pMrS0kBZbIQUkFAwVQiVV1rA0ASEGCQpCDGAwWqKiAX0haBQTozWaGEGW6IMgGGQLloqCLAWxQBfogkCR6aQLZZiZO3Pv8QFieDTknuTkPHwPv5zv///+H7h2hAC+qp5Soup2rVUt9R+pt1dOUkCPdA+CAEQ0YpGenk48HmXujMkA6C5CFKAFc1OI3B0gFo2SE8xzG6IUoJs+g1C4l4RlkTMoD0C62S4AT/+dGKcbWjhzvg1fSgb+DFO4BsnPSRVAX2aql8KCbD7ZcQYBJBKO4xrkVvgewFU0yM3OZO6UYhLJBFYS5abwABw50YltQ7Y/HdPwEfBJXNXEIyWvLZ1IbyRK0kqimz58qaZw1V0zKx8Tg/NzGF9mYRg6UupIqbnrrrzcNDV0SCHPVlWQtG2EkHh03GvX+JF5oqK8RIyd/Dx799ezfstRAHQp3XNXa2dPoK3z1ouxgS52/dT4UEUq1yBerz6mqnLcCIDL5w5TXVVKMnEPy0641y6PJr3jJ80WO7fWYkXCvLlmPol4lHBf1L2Jvxm6G0ta90RL+y1mVK+kqeUqUjcIBryai+4SZ775+ot/Xlm+kFMXu2hquY6yHSJR23GPgZDA7i1vTlcfrpumyor9quuvb1XJUP+jLi0hZk4d4Vk6d6TuM3QN0EEFgCENjdfpDg8w55ky5AM1HmnifT4jf/GscT+WDBtiFxVm/anpeu6GT+smeDyyYMGcCdwO9ZDiM0lacVI17dEgm2ummrPnLRmdFizzFgwurvCYKSxeOJdff/udWQvfoPXcPn6pO45umHhTjUeLlXMXOm8f2Luto//GaTJzizB9frLzSsjO8nOj9RhNTZdZu+kAQmrkB1Pk//yJEPdfpQC27bsULSoMbBlX3v5lWkaWbG1s4HTjVaoqn6T2y+18vPUUu2tfQtdM+u9E7YchBvezzHxwC4HHgZGgSoEIsB5Etz/D63m/9njXU+XDnScnVsmE4xCJWOQMKiR/kJ/+jkMIqfPBpg3Une1S+sRRwTTTa4p4LMGKFyar8xfbF8fi9paC/IBuxROiqrKc8gnThJ2Mi30/7Jiw7J093XfuxtKBgoF4Qr/YeJaCohIqPSb9Pd1omuTcHwdZvXEnl1tDAFli5fwnlGNDQ8tNViyaRHYgg8KCwYx7ejGxgS4Adm6t5VJbF2teXsTBg0dpvxbmmcrRzFpUw9/NR1n/3ueMGBZk7JhikglFMJiLlbDIzxtMqs/TJ07ufksZpkFPTw9X2q7R0xvh2aoK9u6v59Ptpwm1H8eKhJkyaxkXWkN8uG4a3eEBhhZmM6VyIs3NTTz36nYGrh8jOnAbx3HwGD66u65QNGo60d62O6Kl/iNlOzZWLEqoO0QsZnGxueO/fTB/aik1qxbQ0dHJlfZb7D58iRmVpZQNH0J3uI+aDw7RXP8xxaOmsXrlErxeHWzFZ9810N/+M6EbLYiNqyarBdXT8aVlYhgmmm4gpYZ4KKCTyTjJRBxN8+AoBylAaDqGmYrjOKRl5vHV55t5ffMh6natZWzFjPtetC0VKJ0nRXVVqeM4CkeBLsBj6kgh0SUkHQUIHOUQjyfxeXWStsPRU9f6AIYPzZJlwwLyXjRuf3+kTQFZZ/fU9KZm5sgTJ06q5e/u9QP8C65H8/F04OwlAAAAAElFTkSuQmCC");
--f-rt: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAYAAADhAJiYAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAbklEQVRYhe3WoQ2FQAAE0T0I5hsKQFA6JZHQw28B5CFwmEkICSdmCtg8uaXWmpbqvgbcE0QJogRRgihBlCBKENUcqCRle2HnSLIn+SUZkvTX9gPQf12auoxlnsa2QH5qSBAliBJECaIEUYIoQdQJvHANq3sQ4aQAAAAASUVORK5CYII=");
--f-rb: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAVCAYAAAAuJkyQAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAXklEQVRIie3WoQ2AYAxE4VcIAsUACEZnJBJ2YAWC6y9wmMMQKu4N0H7yIjOpVPc34JlBKoNUBqkMUhmkMkhlkKocKJZ5KrXQ4tjWWiCI/YO7J3ABIzAA/f3rBajapm4tPA2NEDQU7QAAAABJRU5ErkJggg==");
--f-rl: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAkCAYAAABmMXGeAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAATUlEQVRIie3MsQ2AMAADQScMwAAUGT0jMQUzUKFPnRosIcUvfXsC9Hap3NfZaccOoCpDQYMGDboGigN9HOjUV2hxoJsDnQoaNGjQf6MDZ409o1SggHIAAAAASUVORK5CYII=");
--f-rr: url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABUAAAAkCAYAAABmMXGeAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAATUlEQVRIiWP4//8/AyVYXpr//9Pz8/8zMDBegokxMdAAjBo6auiooaOGjhxD/w8ZQ3/TwtBvtDCUjRaGctPCUDgYNXTU0FFDRw2lGgAApBY/fjLhM3AAAAAASUVORK5CYII=");
}
.gold-frame {
  position: relative;
  border: 0 !important;
  border-radius: 0 !important; /* pixel corners can't be rounded */
  background-color: var(--panel);
}
.gold-frame::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  image-rendering: pixelated;
  background-image: var(--f-tl), var(--f-tr), var(--f-bl), var(--f-br), var(--f-rt), var(--f-rb), var(--f-rl), var(--f-rr);
  background-repeat: no-repeat, no-repeat, no-repeat, no-repeat, repeat-x, repeat-x, repeat-y, repeat-y;
  background-position: top left, top right, bottom left, bottom right, center -15px, bottom center, -15px center, right center;
  background-size: 25px 30px, 25px 30px, 25px 30px, 25px 30px, 36px 36px, 36px 21px, 21px 36px, 21px 36px;
}
.frame-shimmer {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  image-rendering: pixelated;
  background-image: linear-gradient(115deg, transparent 38%, rgba(255, 255, 255, 0.38) 50%, transparent 62%);
  background-size: 200% 100%;
  background-repeat: no-repeat;
  background-position: 220% 0;
  -webkit-mask-image: var(--f-tl), var(--f-tr), var(--f-bl), var(--f-br), var(--f-rt), var(--f-rb), var(--f-rl), var(--f-rr);
  mask-image: var(--f-tl), var(--f-tr), var(--f-bl), var(--f-br), var(--f-rt), var(--f-rb), var(--f-rl), var(--f-rr);
  -webkit-mask-repeat: no-repeat, no-repeat, no-repeat, no-repeat, repeat-x, repeat-x, repeat-y, repeat-y;
  mask-repeat: no-repeat, no-repeat, no-repeat, no-repeat, repeat-x, repeat-x, repeat-y, repeat-y;
  -webkit-mask-position: top left, top right, bottom left, bottom right, center -15px, bottom center, -15px center, right center;
  mask-position: top left, top right, bottom left, bottom right, center -15px, bottom center, -15px center, right center;
  -webkit-mask-size: 25px 30px, 25px 30px, 25px 30px, 25px 30px, 36px 36px, 36px 21px, 21px 36px, 21px 36px;
  mask-size: 25px 30px, 25px 30px, 25px 30px, 25px 30px, 36px 36px, 36px 21px, 21px 36px, 21px 36px;
  animation: shimmer-sweep 1.6s ease-in-out 0.15s 1 both;
}
@keyframes shimmer-sweep {
  from { background-position: 220% 0; }
  to   { background-position: -120% 0; }
}
@media (prefers-reduced-motion: reduce){
  .frame-shimmer{animation:none}
  .gold-frame::before,.row,.gh,#tabs button,#phead a,#phead button,button.big,a.big,
  #stlbar button,#pane .grid figure{transition:none}
}
/* Hover glow on the framed card, matching app/src/index.css (.gold-frame::before there):
   a red bloom revealed by opacity only, longer ease-out in, quicker fade out. */
.gold-frame::before{content:'';position:absolute;inset:0;z-index:2;pointer-events:none;
  box-shadow:inset 0 0 26px rgba(228,60,60,0.55), 0 0 30px 4px rgba(216,46,46,0.65);
  opacity:0;will-change:opacity;transition:opacity 200ms ease}
.dlcard:hover::before{opacity:1;transition:opacity 420ms cubic-bezier(0.22,1,0.36,1)}
.dlcard{padding:38px 46px;display:flex;flex-direction:column;gap:10px;align-items:center;
        min-width:300px;max-width:80%}
.dlname{font-weight:700;font-size:15px;color:var(--fg);word-break:break-all}
.dlsize{color:var(--faint);font-size:12px}
[hidden]{display:none!important}
</style>
<div id="app">
 <aside id="side">
  <header>
   <h1>drop<small id="cnt"></small></h1>
   <input id="q" placeholder="filter files…" autocomplete="off">
   <div id="tabs">
    <button data-t="m" class="on">modified</button>
    <button data-t="c">created</button>
    <button data-t="o">history</button>
   </div>
  </header>
  <nav id="list"></nav>
  <div id="foot"></div>
 </aside>
 <main id="main">
  <header id="phead" hidden>
   <span id="pname"></span><span id="pmeta"></span><span class="sp"></span>
   <button id="copy">copy link</button><a id="rawlink" target="_blank">raw</a>
  </header>
  <section id="pane"><div class="empty">no files yet — agents drop deliverables here</div></section>
 </main>
</div>
<div id="stlbar" hidden>
 <span id="stlcount"></span>
 <button id="stlview">view together</button>
 <button id="stlclear" class="x">clear</button>
</div>
<script src="/_viewerlib/marked.min.js"></script>
<script>
'use strict';
const $ = s => document.querySelector(s);
const IMG = new Set(['png','jpg','jpeg','gif','svg','webp','avif','bmp','ico']);
const VID = new Set(['mp4','webm','mov','m4v']);
const AUD = new Set(['mp3','wav','ogg','flac','m4a']);
const MODEL = new Set(['stl', '3mf']);   // rows that can join an assembly view
const TXT = new Set(['txt','log','py','js','ts','tsx','jsx','json','yaml','yml','csv','tsv',
  'sh','bash','zsh','toml','ini','cfg','conf','c','cpp','h','hpp','rs','go','java','sql',
  'scad','xml','env','make','mk','dockerfile','caddyfile','service','tf','diff','patch']);
let FILES = [], SEL = null, CHECKED = new Set(), FILTER = '', COPYURL = null, TAB = 'm';

let HIST = [], OVIS = [];                  // server-side history, shared across devices
function getHist(){ return HIST; }
function recordOpen(p){                    // p: file path, 'dir/', or [model, model, ...]
  const k = JSON.stringify(p);
  HIST = [{p, t: Math.floor(Date.now()/1000)}, ...HIST.filter(e => JSON.stringify(e.p) !== k)];
  fetch('/api/opened', {method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({p})}).catch(() => {});
}

const ext = p => { const n = p.split('/').pop(); const i = n.lastIndexOf('.');
  return i < 0 ? '' : n.slice(i+1).toLowerCase(); };
const enc = p => p.split('/').map(encodeURIComponent).join('/');
const base = p => p.split('/').pop();
const dirOf = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function ago(m){ const s = Math.max(0, Date.now()/1000 - m);
  if (s < 60) return Math.floor(s)+'s';
  if (s < 3600) return Math.floor(s/60)+'m';
  if (s < 86400) return Math.floor(s/3600)+'h';
  if (s < 86400*30) return Math.floor(s/86400)+'d';
  return new Date(m*1000).toLocaleDateString(undefined,{month:'short',day:'numeric'}); }
function fmtSize(n){ if (n < 1024) return n+' B';
  if (n < 1048576) return (n/1024).toFixed(1)+' KB';
  if (n < 1073741824) return (n/1048576).toFixed(1)+' MB';
  return (n/1073741824).toFixed(2)+' GB'; }

function baseList(){
  if (TAB === 'c') return [...FILES].sort((a,b) => (b.c || b.m) - (a.c || a.m));
  if (TAB === 'o'){
    const byPath = new Map(FILES.map(f => [f.p, f]));
    return getHist().map(e => {
      if (Array.isArray(e.p))
        return {kind: 'view', parts: e.p, p: e.p.join(','), o: e.t};
      if (e.p.endsWith('/')) return {kind: 'dir', p: e.p, o: e.t};
      const f = byPath.get(e.p);
      return f ? Object.assign({}, f, {o: e.t}) : null;   // dropped file: hide entry
    }).filter(Boolean);
  }
  return FILES;                            // 'm': tree order, newest mtime first
}

function visible(){ const f = FILTER.trim().toLowerCase(), l = baseList();
  return f ? l.filter(x => x.p.toLowerCase().includes(f)) : l; }

function renderList(){
  const vis = visible(), list = $('#list');
  const row = (f, t, showDir) => {
    const e = ext(f.p), on = f.p === SEL ? ' on' : '';
    const cb = MODEL.has(e)
      ? `<input type="checkbox" data-cb="${esc(f.p)}"${CHECKED.has(f.p)?' checked':''}>` : '';
    const bg = e === '3mf' ? '<span class="badge">3MF</span>'
             : e === 'stl' ? '<span class="badge">3D</span>'
             : e === 'html' || e === 'htm' ? '<span class="badge">html</span>' : '';
    const dir = showDir ? `<span class="dir">${esc(dirOf(f.p))}</span>` : '';
    return `<div class="row${on}" data-p="${esc(f.p)}">${cb}
          <span class="nm" title="${esc(f.p)}">${esc(base(f.p))}</span>${dir}${bg}
          <span class="tm">${ago(t)}</span></div>`;
  };
  const orow = (x, i) => {
    if (x.kind === 'view'){
      const nm = x.parts.map(base).join(' + ');
      return `<div class="row" data-i="${i}"><span class="nm" title="${esc(x.parts.join(', '))}">${esc(nm)}</span>
        <span class="badge">3D ×${x.parts.length}</span><span class="tm">${ago(x.o)}</span></div>`;
    }
    const d = x.p.replace(/\/+$/, '');
    return `<div class="row" data-i="${i}"><span class="nm" title="${esc(x.p)}">${esc(base(d))}/</span>
      <span class="dir">${esc(dirOf(d))}</span><span class="badge">dir</span>
      <span class="tm">${ago(x.o)}</span></div>`;
  };
  let h = '';
  if (TAB === 'o'){                        // flat, most recent first; files, folders, assemblies
    OVIS = vis;
    h = vis.map((x, i) => x.kind ? orow(x, i) : row(x, x.o, true)).join('')
        || '<div class="gh">no history yet</div>';
  } else {
    const groups = new Map();              // dir -> files, both in baseList order
    for (const f of vis){ const d = dirOf(f.p);
      if (!groups.has(d)) groups.set(d, []); groups.get(d).push(f); }
    for (const [d, fs] of groups){
      h += `<div class="gh" data-dir="${esc(d)}" title="open folder view">${esc(d || '/')}</div>`;
      h += fs.map(f => row(f, TAB === 'c' ? (f.c || f.m) : f.m, false)).join('');
    }
    if (!vis.length) h = '<div class="gh">no matches</div>';
  }
  list.innerHTML = h;
  $('#cnt').textContent = vis.length ? vis.length + ' files' : '';
  const onRow = list.querySelector('.row.on');
  if (onRow) onRow.scrollIntoView({block:'nearest'});
}

function renderStlBar(){
  const bar = $('#stlbar');
  if (!CHECKED.size){ bar.hidden = true; return; }
  bar.hidden = false;
  $('#stlcount').textContent = CHECKED.size + ' model' + (CHECKED.size > 1 ? 's' : '');
}

// Markdown via vendored marked (GFM: tables, strikethrough, task lists). Content here is
// agent-authored and already runs same-origin when dropped as .html, so raw HTML passthrough
// adds no new exposure. Plain-text fallback if the library failed to load.
function mdRender(src){
  if (window.marked) return marked.parse(src);
  return '<pre>' + esc(src) + '</pre>';
}

function showHead(title, meta, rawHref){
  const ph = $('#phead'); ph.hidden = false;
  $('#pname').textContent = title; $('#pname').title = title;
  $('#pmeta').textContent = meta;
  const a = $('#rawlink');
  if (rawHref){ a.hidden = false; a.href = rawHref; } else a.hidden = true;
}

function previewDir(dir, record = true){
  SEL = null;
  COPYURL = '/d/' + enc(dir) + '/';
  if (dir && record) recordOpen(dir + '/'); // visited folder views count as history
  const fs = FILES.filter(f => dirOf(f.p) === dir);
  const imgs = fs.filter(f => IMG.has(ext(f.p)));
  const models = fs.filter(f => MODEL.has(ext(f.p)));
  const rest = fs.filter(f => !IMG.has(ext(f.p)));
  showHead((dir || '/') + '/', fs.length + ' files', null);
  let h = '';
  if (models.length > 1)
    h += `<div class="filelist"><button class="big" id="dirstl">view ${models.length} models together</button></div>`;
  if (imgs.length){
    h += '<div class="grid">' + imgs.map(f =>
      `<figure data-p="${esc(f.p)}"><img src="/raw/${enc(f.p)}" loading="lazy">
       <figcaption>${esc(base(f.p))}<span>${ago(f.m)}</span></figcaption></figure>`).join('') + '</div>';
  }
  if (rest.length){
    h += '<div class="filelist">' + rest.map(f =>
      `<a href="/d/${enc(f.p)}" data-p="${esc(f.p)}">${esc(base(f.p))} <span style="color:var(--faint)">— ${fmtSize(f.s)}</span></a>`).join('') + '</div>';
  }
  const pane = $('#pane');
  pane.innerHTML = h || '<div class="empty">empty folder</div>';
  pane.querySelectorAll('[data-p]').forEach(el => el.addEventListener('click', ev => {
    ev.preventDefault(); select(el.dataset.p, true); }));
  const b = $('#dirstl');
  if (b) b.addEventListener('click', () => viewStls(models.map(f => f.p)));
  renderList();
}

function preview(f){
  const pane = $('#pane'), e = ext(f.p), raw = '/raw/' + enc(f.p);
  showHead(base(f.p), fmtSize(f.s) + ' · ' + ago(f.m) + ' ago', raw);
  if (IMG.has(e)){
    pane.innerHTML = `<div class="imgwrap"><img src="${raw}"></div>`;
  } else if (e === 'html' || e === 'htm' || e === 'pdf'){
    pane.innerHTML = `<iframe src="${raw}"></iframe>`;
  } else if (MODEL.has(e)){
    pane.innerHTML = `<iframe class="dark" src="/view?f=${encodeURIComponent(f.p)}"></iframe>`;
  } else if (VID.has(e)){
    pane.innerHTML = `<video controls autoplay muted src="${raw}"></video>`;
  } else if (AUD.has(e)){
    pane.innerHTML = `<div class="empty"><audio controls src="${raw}"></audio></div>`;
  } else if (e === 'md' || TXT.has(e) || (!e && f.s < 262144)){
    if (f.s > __TEXT_LIMIT__){
      pane.innerHTML = `<div class="empty">too large to preview — <a style="color:var(--acc)" href="${raw}">open raw</a></div>`;
    } else {
      pane.innerHTML = '<pre>loading…</pre>';
      fetch(raw).then(r => r.text()).then(t => {
        if (SEL !== f.p) return;
        if (e === 'md') pane.innerHTML = `<div class="md">${mdRender(t)}</div>`;
        else { pane.innerHTML = '<pre></pre>'; pane.firstChild.textContent = t; }
      });
    }
  } else {
    pane.innerHTML = `<div class="empty"><div class="gold-frame dlcard">
      <div class="frame-shimmer"></div>
      <div class="dlname">${esc(base(f.p))}</div>
      <div class="dlsize">${fmtSize(f.s)}</div>
      <a class="big" style="text-decoration:none" href="${raw}" download>download</a>
    </div></div>`;
  }
}

function select(p, push, record = push){
  const f = FILES.find(x => x.p === p);
  if (!f) return;
  SEL = p;
  COPYURL = '/d/' + enc(p);
  if (record) recordOpen(p);      // deliberate opens only, not the on-load auto-select
  if (push) history.pushState(null, '', '/d/' + enc(p));
  preview(f);
  renderList();
}

function openEntry(x){                     // open a history entry of any kind
  if (x.kind === 'view'){ viewStls(x.parts); return; }
  if (x.kind === 'dir'){
    const d = x.p.replace(/\/+$/, '');
    history.pushState(null, '', '/d/' + enc(d) + '/');
    previewDir(d);
    return;
  }
  select(x.p, true);
}

function viewStls(paths){
  SEL = null;
  const q = paths.map(encodeURIComponent).join(',');
  COPYURL = '/view?f=' + q;
  showHead(paths.length + ' model assembly', paths.map(base).join(' + '), null);
  $('#pane').innerHTML = `<iframe class="dark" src="/view?f=${q}"></iframe>`;
  renderList();
}

function applyRoute(record){
  // record=true only for the initial deep link; Back/Forward revisits don't re-record
  const path = decodeURIComponent(location.pathname);
  if (path.startsWith('/d/')){
    const p = path.slice(3);
    if (p.endsWith('/')) previewDir(p.replace(/\/+$/, ''), record);
    else if (FILES.some(f => f.p === p)) select(p, false, record);
    else if (FILES.length) select(FILES[0].p, false, false);
  } else if (FILES.length && SEL === null){
    select(FILES[0].p, false, false);
  }
}

async function load(first){
  try {
    const [r, ro] = await Promise.all([fetch('/api/tree'), fetch('/api/opened')]);
    const d = await r.json();
    FILES = d.files;
    try { const h = await ro.json(); if (Array.isArray(h)) HIST = h; } catch (e) {}
    $('#foot').textContent = (d.truncated ? 'showing newest ' + FILES.length + ' files · ' : '')
      + 'newest first · ↑↓ to browse';
    renderList();
    if (first) applyRoute(true);
  } catch (e) { /* transient; next poll retries */ }
}

$('#list').addEventListener('click', ev => {
  const cb = ev.target.closest('input[data-cb]');
  if (cb){ cb.checked ? CHECKED.add(cb.dataset.cb) : CHECKED.delete(cb.dataset.cb);
    renderStlBar(); ev.stopPropagation(); return; }
  const gh = ev.target.closest('.gh');
  if (gh){ history.pushState(null, '', '/d/' + enc(gh.dataset.dir) + '/');
    previewDir(gh.dataset.dir); return; }
  const row = ev.target.closest('.row');
  if (!row) return;
  if (row.dataset.i !== undefined && TAB === 'o') openEntry(OVIS[+row.dataset.i]);
  else select(row.dataset.p, true);
});
$('#q').addEventListener('input', () => { FILTER = $('#q').value; renderList(); });
$('#tabs').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-t]');
  if (!b || b.dataset.t === TAB) return;
  TAB = b.dataset.t;
  document.querySelectorAll('#tabs button').forEach(x =>
    x.classList.toggle('on', x === b));
  renderList();
});
$('#copy').addEventListener('click', () => {
  if (!COPYURL) return;
  navigator.clipboard.writeText(location.origin + COPYURL);
  $('#copy').textContent = 'copied'; setTimeout(() => $('#copy').textContent = 'copy link', 900);
});
$('#stlview').addEventListener('click', () => viewStls([...CHECKED]));
$('#stlclear').addEventListener('click', () => { CHECKED.clear(); renderStlBar(); renderList(); });
document.addEventListener('keydown', ev => {
  if (ev.target.tagName === 'INPUT') return;
  if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
  ev.preventDefault();
  const vis = visible();
  if (!vis.length) return;
  const i = vis.findIndex(f => f.p === SEL);
  const j = ev.key === 'ArrowDown' ? Math.min(vis.length - 1, i + 1) : Math.max(0, i - 1);
  // keyboard traversal: no opened-history record, and replace (not push) so Back
  // doesn't step through every skimmed file
  const t = vis[j < 0 ? 0 : j];
  if (t.kind){ openEntry(t); return; }     // history tab: folders/assemblies open directly
  select(t.p, false, false);
  history.replaceState(null, '', '/d/' + enc(t.p));
});
addEventListener('popstate', () => applyRoute(false));
load(true);
setInterval(() => load(false), 10000);
</script>'''

APP_HTML = APP_HTML.replace('__TEXT_LIMIT__', str(TEXT_PREVIEW_LIMIT))


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'drop'

    def _send(self, code, ctype, body, extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def _send_file(self, full):
        try:
            st = os.stat(full)
        except OSError:
            return self._send(404, 'text/plain', b'not found')
        if not os.path.isfile(full):
            return self._send(404, 'text/plain', b'not found')
        # mtime-based conditional GET: STL/HTML reloads in the viewer stay cheap
        import email.utils as eut
        lm = eut.formatdate(st.st_mtime, usegmt=True)
        ims = self.headers.get('If-Modified-Since')
        if ims == lm:
            self.send_response(304)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        ctype, _ = mimetypes.guess_type(full)
        ctype = ctype or 'application/octet-stream'
        if ctype.startswith('text/') or ctype in ('application/json', 'image/svg+xml'):
            ctype += '; charset=utf-8'
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(st.st_size))
        self.send_header('Last-Modified', lm)
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        if self.command == 'HEAD':
            return
        with open(full, 'rb') as fh:
            while True:
                chunk = fh.read(256 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def do_HEAD(self):
        self.do_GET()

    def do_POST(self):
        # The single write route: record a file as opened. Everything else is GET-only.
        if urllib.parse.urlparse(self.path).path != '/api/opened':
            return self._send(404, 'text/plain', b'not found')
        try:
            n = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            n = -1
        if n < 0 or n > 4096:
            return self._send(413, 'text/plain', b'too large')
        try:
            body = json.loads(self.rfile.read(n) or b'{}')
        except (ValueError, AttributeError):
            return self._send(400, 'text/plain', b'bad request')
        rel = normalize_opened(body.get('p') if isinstance(body, dict) else None)
        if rel is None:
            return self._send(400, 'text/plain', b'bad path')
        record_opened(rel)
        return self._send(200, 'application/json', b'{"ok":true}')

    def do_GET(self):
        try:
            return self._route()
        except Exception:
            # keep-alive means an escaping exception kills the whole connection, and
            # every route here is reachable from a link someone pasted
            try:
                return self._send(500, 'text/plain', b'server error')
            except Exception:
                return

    def _route(self):
        parsed = urllib.parse.urlparse(self.path)
        path = urllib.parse.unquote(parsed.path)

        if path == '/healthz':
            return self._send(200, 'text/plain', b'ok')

        if path == '/api/tree':
            body = json.dumps(build_tree()).encode()
            return self._send(200, 'application/json', body,
                              {'Cache-Control': 'no-store'})

        if path == '/api/opened':
            body = json.dumps(load_opened()).encode()
            return self._send(200, 'application/json', body,
                              {'Cache-Control': 'no-store'})

        if path.startswith('/_viewerlib/'):
            # subdirectories matter: the three.js addons import siblings by relative
            # path ('../libs/fflate.module.js'), so the vendored tree is served as-is
            rel = path[len('/_viewerlib/'):]
            p = os.path.realpath(os.path.join(VIEWERLIB, rel))
            if (p == VIEWERLIB or p.startswith(VIEWERLIB + os.sep)) and os.path.isfile(p):
                with open(p, 'rb') as fh:
                    return self._send(200, 'application/javascript', fh.read(),
                                      {'Cache-Control': 'max-age=86400'})
            return self._send(404, 'text/plain', b'not found')

        if path.startswith('/api/3mf/'):
            full = resolve(path[len('/api/3mf/'):])
            if full is None or not os.path.isfile(full):
                return self._send(404, 'application/json', b'null')
            info = model_info(full)
            return self._send(200, 'application/json', json.dumps(info).encode(),
                              {'Cache-Control': 'no-cache'})

        if path.startswith('/thumb/'):
            # the plate cover the slicer rendered into the 3MF, when it managed to
            full = resolve(path[len('/thumb/'):])
            if full is None or not os.path.isfile(full):
                return self._send(404, 'text/plain', b'not found')
            info = model_info(full)
            member = (info or {}).get('thumb')
            if not member:
                return self._send(404, 'text/plain', b'no thumbnail')
            try:
                with zipfile.ZipFile(full) as zf:
                    if zf.getinfo(member).file_size > 8 * 1024 * 1024:
                        return self._send(404, 'text/plain', b'no thumbnail')
                    png = zf.read(member)
            except (OSError, KeyError, ValueError, zipfile.BadZipFile,
                    RuntimeError, NotImplementedError, EOFError):
                # an encrypted or undecompressable member is a missing cover, not a crash
                return self._send(404, 'text/plain', b'no thumbnail')
            import email.utils as eut
            lm = eut.formatdate(os.path.getmtime(full), usegmt=True)
            return self._send(200, 'image/png', png,
                              {'Cache-Control': 'no-cache', 'Last-Modified': lm})

        if path == '/view':
            q = urllib.parse.parse_qs(parsed.query).get('f', [''])[0]
            rels = [r.strip().strip('/') for r in q.split(',') if r.strip()]
            files = []
            for r in rels:
                full = resolve(r)
                if full and os.path.isfile(full):
                    files.append(os.path.relpath(full, ROOT).replace(os.sep, '/'))
            files = files[:MAX_ASSEMBLY]
            if not files:
                return self._send(404, 'text/plain', b'no such model')
            import html as _html
            title = ' + '.join(os.path.basename(f) for f in files)
            body = (VIEWER_HTML.replace('%TITLE%', _html.escape(title))
                               .replace('%FILES%', script_json(files)))
            return self._send(200, 'text/html; charset=utf-8', body.encode())

        if path.startswith('/raw/'):
            full = resolve(path[5:])
            if full is None:
                return self._send(404, 'text/plain', b'not found')
            return self._send_file(full)

        if path == '/' or path.startswith('/d/'):
            return self._send(200, 'text/html; charset=utf-8', APP_HTML.encode(),
                              {'Cache-Control': 'no-cache'})

        return self._send(404, 'text/plain', b'not found')

    def log_message(self, *a):
        pass


if __name__ == '__main__':
    with http.server.ThreadingHTTPServer((BIND, PORT), Handler) as srv:
        print(f'drop: serving {ROOT} on {BIND}:{PORT}', flush=True)
        srv.serve_forever()
