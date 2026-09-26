"""3MF sidecar reader: the slicer metadata three.js's 3MFLoader does not read.

Bambu Studio and Orca Slicer keep the print job description in Metadata/*.config, outside
the 3MF core spec, so the geometry loader in the browser never sees it. This reads the
parts a preview wants: real filament colors per build item, and the plate summary.
Keys follow BambuStudio src/libslic3r/Format/bbs_3mf.cpp: prediction is seconds,
weight is grams, used_m is meters, used_g is grams.
"""
import json
import re
import xml.etree.ElementTree as ET
import zipfile

MODEL_ROOT = '3D/3dmodel.model'
MAX_MEMBER = 8 * 1024 * 1024       # a config member larger than this is not a config member
MESH_MEMBER = 256 * 1024 * 1024    # cap on the root model part, which may inline the mesh
BUILD_WINDOW = 4 * 1024 * 1024     # tail of it retained while scanning for <build>
MAX_ITEMS = 10000                  # build items reported, which bounds the response size
MAX_ENTRIES = 20000                # zip members walked, which bounds central-directory work


def _tag(el):
    return el.tag.rsplit('}', 1)[-1]


def _read(zf, name, limit=MAX_MEMBER):
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > limit:
        return None
    try:
        return zf.read(name)
    except (OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError):
        # RuntimeError is an encrypted member, NotImplementedError an unsupported
        # compression method. A member that will not decompress is simply absent.
        return None


def _read_tail(zf, name, window=BUILD_WINDOW, limit=MESH_MEMBER):
    """The last `window` bytes of a member, streamed so a mesh inlined into it is never
    held in memory. Returns (tail, truncated_from_front)."""
    try:
        fh = zf.open(name)
    except (KeyError, OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError):
        return b'', False
    buf = b''
    total = 0
    try:
        with fh:
            while total < limit:
                chunk = fh.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                buf = (buf + chunk)[-window:]
    except (OSError, zipfile.BadZipFile, RuntimeError, NotImplementedError, EOFError):
        return b'', False
    return buf, total > len(buf)


def _xml(zf, name):
    raw = _read(zf, name)
    if not raw:
        return None
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        return None


def _meta(el):
    """<metadata key=".." value=".."/> children as a dict."""
    out = {}
    for m in el:
        if _tag(m) == 'metadata' and m.get('key'):
            out[m.get('key')] = m.get('value')
    return out


def _num(s, cast=float):
    try:
        return cast(s)
    except (TypeError, ValueError):
        return None


HEX = re.compile(r'^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$')


def _color(s):
    return s[:7].upper() if s and HEX.match(s) else None


ITEM = re.compile(rb'''<item\s[^>]*?\bobjectid\s*=\s*(["'])(.*?)\1''', re.DOTALL)
BUILD_OPEN = re.compile(rb'<build[\s>]')


def _build_items(zf):
    """Object ids referenced by <build><item>, in document order. three.js's 3MFLoader
    clones build items in this same order, so index i here is group.children[i] there.

    Scanned rather than XML-parsed: in a 3MF whose mesh is inline rather than split into
    3D/Objects/, this member carries every vertex, and parsing tens of MB of geometry to
    reach the handful of <item> elements at the end costs seconds. Only the tail is held,
    and the count is capped, because neither the member size nor the element count is
    bounded by anything the file has to declare up front."""
    raw, _ = _read_tail(zf, MODEL_ROOT)
    if not raw:
        return []
    # The first <build that actually contains an <item> wins. Matching the last one
    # instead loses every item to a trailing comment mentioning the tag.
    out = []
    for m in BUILD_OPEN.finditer(raw):
        out = [im.group(2).decode('ascii', 'replace')
               for im in ITEM.finditer(raw, m.end())][:MAX_ITEMS]
        if out:
            break
    return out


def _objects(zf):
    """Per-object name, face count and extruder index from model_settings.config."""
    root = _xml(zf, 'Metadata/model_settings.config')
    out = {}
    if root is None:
        return out
    for obj in root:
        if _tag(obj) != 'object' or not obj.get('id'):
            continue
        meta = _meta(obj)
        faces = None
        for m in obj:
            if _tag(m) == 'metadata' and m.get('face_count'):
                faces = _num(m.get('face_count'), int)
        out[obj.get('id')] = {
            'name': meta.get('name'),
            'extruder': _num(meta.get('extruder'), int),
            'faces': faces,
        }
    return out


PLATE_PNG = re.compile(r'^Metadata/plate_(\d+)\.png$')


def _thumbs(names):
    """Rendered plate covers, keyed by plate index, plus a generic fallback. These are
    written only when the slicer had a working GL context, so most headless slices carry
    none; `plate_no_light_N` is the unlit variant of the same view."""
    out = {}
    for n in names:
        m = PLATE_PNG.match(n)
        if m:
            out[int(m.group(1))] = n
    for n in names:
        m = re.match(r'^Metadata/plate_no_light_(\d+)\.png$', n)
        if m:
            out.setdefault(int(m.group(1)), n)
    if 'Metadata/thumbnail.png' in names:
        out.setdefault(0, 'Metadata/thumbnail.png')
    return out


def _plates(zf, thumbs, names):
    """Every <plate> in slice_info.config. Iterating all of them matters: a project can
    hold several plates and only one of them is plate 1."""
    root = _xml(zf, 'Metadata/slice_info.config')
    plates = []
    if root is None:
        return plates
    for pl in root:
        if _tag(pl) != 'plate':
            continue
        meta = _meta(pl)
        idx = _num(meta.get('index'), int)
        fils, objs = [], []
        for ch in pl:
            if _tag(ch) == 'filament':
                fils.append({
                    'id': _num(ch.get('id'), int),
                    'type': ch.get('type'),
                    'color': _color(ch.get('color')),
                    'used_m': _num(ch.get('used_m')),
                    'used_g': _num(ch.get('used_g')),
                })
            elif _tag(ch) == 'object' and ch.get('name'):
                objs.append(ch.get('name'))
        plates.append({
            'index': idx,
            'seconds': _num(meta.get('prediction'), int),
            'grams': _num(meta.get('weight')),
            'support': meta.get('support_used') == 'true',
            'filaments': fils,
            'objects': objs,
            'thumb': thumbs.get(idx),
            # the embedded g-code is what makes a plate printable without re-slicing
            'gcode': f'Metadata/plate_{idx}.gcode' in names if idx else False,
        })
    plates.sort(key=lambda p: p['index'] if p['index'] is not None else 0)
    return plates


def _settings(zf):
    raw = _read(zf, 'Metadata/project_settings.config')
    if not raw:
        return {}
    try:
        cfg = json.loads(raw)
    except ValueError:
        return {}
    return cfg if isinstance(cfg, dict) else {}


def _first(v):
    return v[0] if isinstance(v, list) and v else (v if isinstance(v, str) else None)


def read_3mf(path):
    """Summarize a 3MF for the previewer. Returns None if it is not a readable zip."""
    try:
        zf = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile):
        return None
    with zf:
        try:
            if len(zf.infolist()) > MAX_ENTRIES:
                return None
        except (OSError, zipfile.BadZipFile):
            return None
        objects = _objects(zf)
        names = set(zf.namelist())
        thumbs = _thumbs(names)
        plates = _plates(zf, thumbs, names)
        cfg = _settings(zf)

        # extruder index -> filament color. slice_info lists only filaments actually used
        # and carries the real spool color, so it wins over the settings dump.
        bycolor = {}
        for pl in plates:
            for f in pl['filaments']:
                if f['id'] is not None and f['color'] and f['id'] not in bycolor:
                    bycolor[f['id']] = f['color']
        for i, c in enumerate(cfg.get('filament_colour') or [], start=1):
            bycolor.setdefault(i, _color(c))

        items = []
        for oid in _build_items(zf):
            o = objects.get(oid, {})
            ext = o.get('extruder')
            # extruder and filament ids are 1-based throughout Bambu output
            items.append({
                'name': o.get('name'),
                'faces': o.get('faces'),
                'extruder': ext,
                'color': bycolor.get(ext) if ext is not None else None,
            })

        ftypes = cfg.get('filament_type') or []
        return {
            'items': items,
            'plates': plates,
            'printer': cfg.get('printer_model'),
            'layer': _num(cfg.get('layer_height')),
            'first_layer': _num(cfg.get('initial_layer_print_height')),
            'nozzle': _first(cfg.get('nozzle_diameter')),
            'filament_types': ftypes if isinstance(ftypes, list) else [],
            'sliced': any(p['gcode'] for p in plates),
            # a cover to show while the mesh loads, when the slicer managed to render one
            'thumb': (next((p['thumb'] for p in plates if p['thumb']), None)
                      or (thumbs.get(0) or (thumbs.get(min(thumbs)) if thumbs else None))),
        }
