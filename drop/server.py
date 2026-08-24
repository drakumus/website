"""Drop server: tailnet-only previewer for agent deliverables (see ~/specs/drop-server.md).

Serves DROP_ROOT read-only as a single-page file browser: a newest-first file list
grouped by directory, with an inline preview pane (HTML, images, STL assemblies,
markdown, text, PDF, video). GET-only, stdlib-only, no upload or mutation routes.

Routes:
  /                  browser UI (newest file preselected)
  /d/<path>          browser UI with <path> preselected (the link agents paste)
  /raw/<path>        the file itself (iframe/img sources, downloads)
  /view?f=a,b,c      standalone multi-STL 3D viewer (assembly view)
  /api/tree          flat JSON file list, newest first
  /_viewerlib/<js>   Three.js assets for the viewer
  /healthz           200 ok

Env: DROP_ROOT (default /data), DROP_PORT (8484), DROP_BIND (0.0.0.0).
"""
import http.server
import json
import mimetypes
import os
import threading
import time
import urllib.parse

ROOT = os.path.realpath(os.environ.get('DROP_ROOT', '/data'))
PORT = int(os.environ.get('DROP_PORT', '8484'))
BIND = os.environ.get('DROP_BIND', '0.0.0.0')
STATE = os.environ.get('DROP_STATE', '')   # writable dir for opened-history; in-memory if unset
VIEWERLIB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'viewerlib')

EXCLUDE_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', 'venv', '.cache',
                '.pytest_cache', 'dist', '.next'}
MAX_FILES = 4000          # newest wins when the walk finds more
TREE_TTL_SECONDS = 3.0
TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024

mimetypes.add_type('model/stl', '.stl')
mimetypes.add_type('text/markdown', '.md')
mimetypes.add_type('application/octet-stream', '.3mf')
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
    full = os.path.realpath(os.path.join(ROOT, rel))
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


VIEWER_HTML = '''<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>3D — %TITLE%</title>
<style>body{margin:0;background:#131417;color:#ececec;overflow:hidden;
font:13px "Open Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
#hud{position:fixed;top:10px;left:12px;z-index:2;color:#9a9a9a}
#hud .m{display:block}#hud .sw{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}
#hud .hint{color:#6f6f6f;margin-top:4px;display:block}</style>
<div id="hud"><span class="hint">drag orbit &middot; scroll zoom &middot; right-drag pan</span></div>
<script src="/_viewerlib/three.min.js"></script>
<script src="/_viewerlib/OrbitControls.js"></script>
<script>
const FILES = %FILES%;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x16171a);
const camera = new THREE.PerspectiveCamera(45, innerWidth/innerHeight, 0.1, 5000);
const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
document.body.appendChild(renderer.domElement);
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x26262c, 0.85));
const d1 = new THREE.DirectionalLight(0xffffff, 0.8); d1.position.set(1,2,1.5); scene.add(d1);
const d2 = new THREE.DirectionalLight(0xffffff, 0.3); d2.position.set(-1.5,-1,-1); scene.add(d2);
// site palette family: gold, maroon, neutrals, steel (shared/theme.css tokens)
const COLS = [0xc4a054, 0xc62828, 0x9a9a9a, 0x6d8bb0, 0xd9c9a3, 0x7a4a3a];
const hud = document.getElementById('hud');
FILES.forEach((f,i) => {
  const m = document.createElement('span'); m.className = 'm';
  const sw = document.createElement('span'); sw.className = 'sw';
  sw.style.background = '#'+COLS[i%COLS.length].toString(16).padStart(6,'0');
  m.appendChild(sw); m.appendChild(document.createTextNode(f.split('/').pop()));
  hud.insertBefore(m, hud.lastElementChild);
});
function parseSTL(buf){
  const dv = new DataView(buf); const n = dv.getUint32(80, true);
  const pos = new Float32Array(n*9);
  for(let i=0;i<n;i++){const o=84+i*50;
    for(let v=0;v<3;v++){const p=o+12+v*12,k=i*9+v*3;
      pos[k]=dv.getFloat32(p,true);pos[k+1]=dv.getFloat32(p+4,true);pos[k+2]=dv.getFloat32(p+8,true);}}
  // merge duplicate vertices so smooth vertex normals can be computed
  const map = new Map(), idx = new Uint32Array(n*3), uniq = [];
  for(let v=0; v<n*3; v++){
    const k = pos[v*3].toFixed(3)+','+pos[v*3+1].toFixed(3)+','+pos[v*3+2].toFixed(3);
    let u = map.get(k);
    if(u === undefined){ u = uniq.length/3; map.set(k,u);
      uniq.push(pos[v*3], pos[v*3+1], pos[v*3+2]); }
    idx[v] = u;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(uniq),3));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  g.computeVertexNormals();
  return g;
}
const enc = p => p.split('/').map(encodeURIComponent).join('/');
// a viewed assembly (or single model) counts as history, including pasted /view links
fetch('/api/opened', {method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({p: FILES.length > 1 ? FILES : FILES[0]})}).catch(() => {});
Promise.all(FILES.map(f => fetch('/raw/'+enc(f)).then(r => r.arrayBuffer()))).then(bufs => {
  const box = new THREE.Box3();
  bufs.forEach((b,i) => {
    const m = new THREE.Mesh(parseSTL(b),
      new THREE.MeshStandardMaterial({color:COLS[i%COLS.length], roughness:.6, metalness:.05}));
    scene.add(m); box.expandByObject(m);
  });
  const c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  controls.target.copy(c);
  camera.position.set(c.x + size*0.7, c.y - size*0.7, c.z + size*0.5);
  camera.up.set(0,0,1);
  camera.near = size/100; camera.far = size*10; camera.updateProjectionMatrix();
});
addEventListener('resize', () => { camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
(function loop(){ requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
</script>'''


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
const TXT = new Set(['txt','log','py','js','ts','tsx','jsx','json','yaml','yml','csv','tsv',
  'sh','bash','zsh','toml','ini','cfg','conf','c','cpp','h','hpp','rs','go','java','sql',
  'scad','xml','env','make','mk','dockerfile','caddyfile','service','tf','diff','patch']);
let FILES = [], SEL = null, CHECKED = new Set(), FILTER = '', COPYURL = null, TAB = 'm';

let HIST = [], OVIS = [];                  // server-side history, shared across devices
function getHist(){ return HIST; }
function recordOpen(p){                    // p: file path, 'dir/', or [stl, stl, ...]
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
    const cb = e === 'stl'
      ? `<input type="checkbox" data-cb="${esc(f.p)}"${CHECKED.has(f.p)?' checked':''}>` : '';
    const bg = e === 'stl' ? '<span class="badge">3D</span>'
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
  $('#stlcount').textContent = CHECKED.size + ' STL' + (CHECKED.size > 1 ? 's' : '');
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
  const stls = fs.filter(f => ext(f.p) === 'stl');
  const rest = fs.filter(f => !IMG.has(ext(f.p)));
  showHead((dir || '/') + '/', fs.length + ' files', null);
  let h = '';
  if (stls.length > 1)
    h += `<div class="filelist"><button class="big" id="dirstl">view ${stls.length} STLs together</button></div>`;
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
  if (b) b.addEventListener('click', () => viewStls(stls.map(f => f.p)));
  renderList();
}

function preview(f){
  const pane = $('#pane'), e = ext(f.p), raw = '/raw/' + enc(f.p);
  showHead(base(f.p), fmtSize(f.s) + ' · ' + ago(f.m) + ' ago', raw);
  if (IMG.has(e)){
    pane.innerHTML = `<div class="imgwrap"><img src="${raw}"></div>`;
  } else if (e === 'html' || e === 'htm' || e === 'pdf'){
    pane.innerHTML = `<iframe src="${raw}"></iframe>`;
  } else if (e === 'stl'){
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
  showHead(paths.length + ' STL assembly', paths.map(base).join(' + '), null);
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
            name = os.path.basename(path)
            p = os.path.join(VIEWERLIB, name)
            if os.path.isfile(p):
                with open(p, 'rb') as fh:
                    return self._send(200, 'application/javascript', fh.read(),
                                      {'Cache-Control': 'max-age=86400'})
            return self._send(404, 'text/plain', b'not found')

        if path == '/view':
            q = urllib.parse.parse_qs(parsed.query).get('f', [''])[0]
            rels = [r.strip().strip('/') for r in q.split(',') if r.strip()]
            files = []
            for r in rels:
                full = resolve(r)
                if full and os.path.isfile(full):
                    files.append(os.path.relpath(full, ROOT).replace(os.sep, '/'))
            if not files:
                return self._send(404, 'text/plain', b'no such stl')
            import html as _html
            title = ' + '.join(os.path.basename(f) for f in files)
            body = (VIEWER_HTML.replace('%FILES%', script_json(files))
                               .replace('%TITLE%', _html.escape(title)))
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
