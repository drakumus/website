"""Path-confinement and tree tests for the drop server. Run: python3 -m unittest"""
import io
import json
import os
import tempfile
import unittest
import zipfile

os.environ.setdefault('DROP_ROOT', tempfile.mkdtemp(prefix='drop-test-'))
import server
import threemf


def make_3mf(path, *, objects=(('2', 'part.stl', 1, 120),), filaments=((1, 'PLA', '#00AE42'),),
             gcode=True, thumb=False, inline_mesh=False):
    """A Bambu-shaped 3MF: build items in the root model, meshes split into 3D/Objects,
    and the print description in the Metadata/*.config sidecars."""
    items = ''.join(f'<item objectid="{oid}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>'
                    for oid, _, _, _ in objects)
    mesh = ('<mesh><vertices><vertex x="0" y="0" z="0"/></vertices></mesh>'
            if inline_mesh else '')
    root = ('<?xml version="1.0" encoding="UTF-8"?>'
            '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">'
            f'<resources><object id="1" type="model">{mesh}</object></resources>'
            f'<build>{items}</build></model>')
    objs = ''.join(
        f'<object id="{oid}"><metadata key="name" value="{name}"/>'
        f'<metadata key="extruder" value="{ext}"/><metadata face_count="{faces}"/></object>'
        for oid, name, ext, faces in objects)
    fils = ''.join(
        f'<filament id="{fid}" type="{ftype}" color="{color}" used_m="10.5" used_g="31.2"/>'
        for fid, ftype, color in filaments)
    slice_info = ('<?xml version="1.0"?><config><plate>'
                  '<metadata key="index" value="1"/>'
                  '<metadata key="prediction" value="3600"/>'
                  '<metadata key="weight" value="31.20"/>'
                  '<metadata key="support_used" value="true"/>'
                  f'{fils}</plate></config>')
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('[Content_Types].xml', '<Types/>')
        z.writestr('_rels/.rels', '<Relationships/>')
        z.writestr('3D/3dmodel.model', root)
        z.writestr('3D/Objects/object_1.model', '<model/>')
        z.writestr('Metadata/model_settings.config', f'<?xml version="1.0"?><config>{objs}</config>')
        z.writestr('Metadata/slice_info.config', slice_info)
        z.writestr('Metadata/project_settings.config', json.dumps({
            'printer_model': 'Bambu Lab X2D', 'layer_height': '0.2',
            'initial_layer_print_height': '0.25', 'nozzle_diameter': ['0.4'],
            'filament_type': ['PLA'], 'filament_colour': ['#112233', '#445566'],
        }))
        if gcode:
            z.writestr('Metadata/plate_1.gcode', '; gcode\n')
        if thumb:
            z.writestr('Metadata/plate_1.png', b'\x89PNG\r\n\x1a\n' + b'0' * 40)
    return path


class ResolveConfinement(unittest.TestCase):
    """/raw and /view must never serve a path outside DROP_ROOT."""

    @classmethod
    def setUpClass(cls):
        cls.root = server.ROOT
        os.makedirs(os.path.join(cls.root, 'proj'), exist_ok=True)
        with open(os.path.join(cls.root, 'proj', 'a.txt'), 'w') as fh:
            fh.write('inside')
        cls.outside = tempfile.NamedTemporaryFile(delete=False, suffix='.txt')
        cls.outside.write(b'outside')
        cls.outside.close()
        # symlink escaping the root must not be followed out
        cls.link = os.path.join(cls.root, 'proj', 'escape.txt')
        if not os.path.lexists(cls.link):
            os.symlink(cls.outside.name, cls.link)

    def test_normal_path_resolves(self):
        self.assertEqual(server.resolve('proj/a.txt'),
                         os.path.join(self.root, 'proj', 'a.txt'))

    def test_leading_slashes_stripped(self):
        self.assertEqual(server.resolve('//proj/a.txt'),
                         os.path.join(self.root, 'proj', 'a.txt'))

    def test_dotdot_rejected(self):
        self.assertIsNone(server.resolve('../etc/passwd'))
        self.assertIsNone(server.resolve('proj/../../etc/passwd'))

    def test_empty_segment_rejected(self):
        self.assertIsNone(server.resolve('proj//a.txt'))
        self.assertIsNone(server.resolve(''))

    def test_symlink_out_of_root_rejected(self):
        self.assertIsNone(server.resolve('proj/escape.txt'))

    def test_absolute_style_is_treated_as_root_relative(self):
        # "/etc/passwd" means "etc/passwd" under the root, never the real /etc/passwd
        os.makedirs(os.path.join(self.root, 'etc'), exist_ok=True)
        with open(os.path.join(self.root, 'etc', 'passwd'), 'w') as fh:
            fh.write('decoy')
        self.assertEqual(server.resolve('/etc/passwd'),
                         os.path.join(self.root, 'etc', 'passwd'))

    def test_nul_byte_rejected_not_raised(self):
        # realpath raises ValueError on an embedded NUL; with keep-alive an escaping
        # exception takes down the connection rather than returning a 404
        self.assertIsNone(server.resolve('a\x00b.stl'))


class ScriptJson(unittest.TestCase):
    def test_script_breakout_is_escaped(self):
        out = server.script_json(['a</script><script>alert(1)</script>.stl'])
        self.assertNotIn('</script', out)
        self.assertNotIn('<script', out)
        import json
        self.assertEqual(json.loads(out),
                         ['a</script><script>alert(1)</script>.stl'])


class NormalizeOpened(unittest.TestCase):
    """History entries: file paths, folder paths ('/'-suffixed), or STL assembly lists."""

    @classmethod
    def setUpClass(cls):
        cls.root = server.ROOT
        os.makedirs(os.path.join(cls.root, 'proj'), exist_ok=True)
        for name in ('a.txt', 'b.txt'):
            with open(os.path.join(cls.root, 'proj', name), 'w') as fh:
                fh.write('x')

    def test_file_and_dot_segments_normalize(self):
        self.assertEqual(server.normalize_opened('proj/./a.txt'), 'proj/a.txt')

    def test_dir_gets_trailing_slash(self):
        self.assertEqual(server.normalize_opened('proj'), 'proj/')

    def test_assembly_list_of_files(self):
        self.assertEqual(server.normalize_opened(['proj/a.txt', 'proj/b.txt']),
                         ['proj/a.txt', 'proj/b.txt'])

    def test_invalid_entries_rejected(self):
        self.assertIsNone(server.normalize_opened('../etc'))
        self.assertIsNone(server.normalize_opened('proj/nope.txt'))
        self.assertIsNone(server.normalize_opened(['proj/a.txt']))        # 1 item: not an assembly
        self.assertIsNone(server.normalize_opened(['proj/a.txt', 'proj']))  # dir inside list
        self.assertIsNone(server.normalize_opened(['proj/a.txt', 42]))
        self.assertIsNone(server.normalize_opened(None))


class OpenedHistory(unittest.TestCase):
    def setUp(self):
        server.STATE = tempfile.mkdtemp(prefix='drop-state-')

    def test_record_dedupes_orders_and_caps(self):
        for rel in ['a.txt', 'b.txt', 'a.txt']:
            server.record_opened(rel)
        hist = server.load_opened()
        self.assertEqual([e['p'] for e in hist], ['a.txt', 'b.txt'])
        for i in range(server.OPENED_CAP + 10):
            server.record_opened(f'f{i}.txt')
        self.assertEqual(len(server.load_opened()), server.OPENED_CAP)

    def test_corrupt_state_file_returns_empty(self):
        with open(server._opened_path(), 'w') as fh:
            fh.write('not json')
        self.assertEqual(server.load_opened(), [])


class TreeWalk(unittest.TestCase):
    def test_tree_lists_files_newest_first_and_hides_dotfiles(self):
        with open(os.path.join(server.ROOT, '.hidden'), 'w') as fh:
            fh.write('x')
        server._tree_cache['data'] = None
        data = server.build_tree()
        paths = [f['p'] for f in data['files']]
        self.assertIn('proj/a.txt', paths)
        self.assertNotIn('.hidden', paths)
        mtimes = [f['m'] for f in data['files']]
        self.assertEqual(mtimes, sorted(mtimes, reverse=True))


class ThreeMFMetadata(unittest.TestCase):
    """The slicer sidecars three.js's mesh loader cannot see."""

    @classmethod
    def setUpClass(cls):
        cls.dir = tempfile.mkdtemp(prefix='drop-3mf-')

    def path(self, name):
        return os.path.join(self.dir, name)

    def test_build_item_order_carries_names_colors_and_faces(self):
        # Order matters: three.js clones build items in document order, so the viewer
        # pairs items[i] with group.children[i]. A reordered list silently miscolors.
        f = make_3mf(self.path('two.3mf'),
                     objects=(('2', 'body.stl', 1, 100), ('4', 'art.stl', 2, 200)),
                     filaments=((1, 'PLA', '#00AE42'), (2, 'PETG', '#FF0000')))
        info = threemf.read_3mf(f)
        self.assertEqual([i['name'] for i in info['items']], ['body.stl', 'art.stl'])
        self.assertEqual([i['color'] for i in info['items']], ['#00AE42', '#FF0000'])
        self.assertEqual([i['faces'] for i in info['items']], [100, 200])

    def test_slice_info_color_beats_settings_dump(self):
        # project_settings.config lists every configured slot; slice_info lists the
        # filaments actually used, with the real spool color.
        info = threemf.read_3mf(make_3mf(self.path('c.3mf')))
        self.assertEqual(info['items'][0]['color'], '#00AE42')

    def test_settings_colour_used_when_slice_info_has_none(self):
        info = threemf.read_3mf(make_3mf(self.path('nofil.3mf'), filaments=()))
        self.assertEqual(info['items'][0]['color'], '#112233')

    def test_plate_summary_units(self):
        info = threemf.read_3mf(make_3mf(self.path('u.3mf')))
        plate = info['plates'][0]
        self.assertEqual(plate['seconds'], 3600)      # prediction is seconds
        self.assertEqual(plate['grams'], 31.20)       # weight is grams
        self.assertTrue(plate['support'])
        self.assertEqual(info['printer'], 'Bambu Lab X2D')
        self.assertEqual(info['layer'], 0.2)

    def test_sliced_flag_tracks_embedded_gcode(self):
        # This is the print-viability signal: a plate without g-code has to be re-sliced.
        self.assertTrue(threemf.read_3mf(make_3mf(self.path('s.3mf'), gcode=True))['sliced'])
        self.assertFalse(threemf.read_3mf(make_3mf(self.path('n.3mf'), gcode=False))['sliced'])

    def test_thumbnail_found_only_when_present(self):
        self.assertIsNone(threemf.read_3mf(make_3mf(self.path('t0.3mf')))['thumb'])
        self.assertEqual(threemf.read_3mf(make_3mf(self.path('t1.3mf'), thumb=True))['thumb'],
                         'Metadata/plate_1.png')

    def test_build_items_scanned_not_parsed(self):
        # A root model part can carry the whole mesh inline; the <build> list must still
        # be reachable without XML-parsing the geometry.
        info = threemf.read_3mf(make_3mf(self.path('inline.3mf'), inline_mesh=True))
        self.assertEqual(len(info['items']), 1)

    def test_trailing_mention_of_build_does_not_erase_the_items(self):
        # A comment or stray text after </build> that contains "<build" must not be
        # mistaken for the real element, which would silently drop every colour.
        f = self.path('comment.3mf')
        make_3mf(f)
        with zipfile.ZipFile(f) as z:
            parts = {n: z.read(n) for n in z.namelist()}
        parts['3D/3dmodel.model'] = parts['3D/3dmodel.model'].replace(
            b'</model>', b'<!-- <build> regenerated by pipeline --></model>')
        with zipfile.ZipFile(f, 'w') as z:
            for n, d in parts.items():
                z.writestr(n, d)
        self.assertEqual(len(threemf.read_3mf(f)['items']), 1)

    def test_single_quoted_attributes_are_read(self):
        f = self.path('squote.3mf')
        make_3mf(f)
        with zipfile.ZipFile(f) as z:
            parts = {n: z.read(n) for n in z.namelist()}
        parts['3D/3dmodel.model'] = parts['3D/3dmodel.model'].replace(
            b'<item objectid="2"', b"<item objectid='2'")
        with zipfile.ZipFile(f, 'w') as z:
            for n, d in parts.items():
                z.writestr(n, d)
        self.assertEqual(len(threemf.read_3mf(f)['items']), 1)

    def test_build_item_count_is_capped(self):
        # Nothing in the format bounds the item count, and the parsed list becomes a
        # JSON response, so an unbounded file would be an unbounded response.
        f = self.path('many.3mf')
        items = b''.join(b'<item objectid="2"/>' for _ in range(threemf.MAX_ITEMS + 500))
        make_3mf(f)
        with zipfile.ZipFile(f) as z:
            parts = {n: z.read(n) for n in z.namelist()}
        parts['3D/3dmodel.model'] = parts['3D/3dmodel.model'].replace(
            b'<build>', b'<build>' + items)
        with zipfile.ZipFile(f, 'w') as z:
            for n, d in parts.items():
                z.writestr(n, d)
        self.assertEqual(len(threemf.read_3mf(f)['items']), threemf.MAX_ITEMS)

    def test_garbage_is_not_fatal(self):
        bad = self.path('bad.3mf')
        with open(bad, 'wb') as fh:
            fh.write(b'not a zip at all')
        self.assertIsNone(threemf.read_3mf(bad))

    def test_empty_zip_yields_no_items(self):
        empty = self.path('empty.3mf')
        with zipfile.ZipFile(empty, 'w') as z:
            z.writestr('[Content_Types].xml', '<Types/>')
        info = threemf.read_3mf(empty)
        self.assertEqual(info['items'], [])
        self.assertEqual(info['plates'], [])
        self.assertFalse(info['sliced'])


class MetadataCache(unittest.TestCase):
    def test_timestamp_preserving_rewrite_is_not_served_stale(self):
        # Copying a file in with its timestamp preserved (cp -p, rsync -a) is an
        # expected way to land content here, so mtime alone cannot key the cache.
        path = os.path.join(server.ROOT, 'cached.3mf')
        make_3mf(path, objects=(('2', 'first.stl', 1, 10),))
        st = os.stat(path)
        self.assertEqual(server.model_info(path)['items'][0]['name'], 'first.stl')
        make_3mf(path, objects=(('2', 'second.stl', 1, 10), ('4', 'extra.stl', 2, 20)))
        os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))
        self.assertEqual(server.model_info(path)['items'][0]['name'], 'second.stl')

    def test_non_model_paths_do_not_occupy_the_cache(self):
        txt = os.path.join(server.ROOT, 'proj', 'a.txt')
        self.assertIsNone(server.model_info(txt))

    def test_cache_evicts_oldest_rather_than_flushing(self):
        server._3mf_cache.clear()
        paths = []
        for i in range(server.THREEMF_CACHE_MAX + 3):
            p = os.path.join(server.ROOT, f'c{i}.3mf')
            make_3mf(p)
            paths.append(p)
            server.model_info(p)
        self.assertEqual(len(server._3mf_cache), server.THREEMF_CACHE_MAX)
        # the most recent survived, which a wholesale clear would not guarantee
        keys = [k[0] for k in server._3mf_cache]
        self.assertIn(paths[-1], keys)


class ViewerLib(unittest.TestCase):
    """Serving and confinement are covered by Routes over the wire; what is left is
    that the vendored tree is actually complete."""

    def test_viewerlib_is_realpathed(self):
        # The handler compares a realpath against this constant, so if it keeps
        # symlinks the comparison never matches and every module 404s.
        self.assertEqual(server.VIEWERLIB, os.path.realpath(server.VIEWERLIB))

    def test_vendored_tree_is_complete(self):
        # The import graph has no CDN fallback: a missing sibling is a blank viewer.
        for rel in ('three.module.js', 'three.core.js', 'camera-controls.module.min.js',
                    'three-viewport-gizmo.js', 'loaders/3MFLoader.js', 'loaders/STLLoader.js',
                    'libs/fflate.module.js', 'utils/BufferGeometryUtils.js'):
            self.assertTrue(os.path.isfile(os.path.join(server.VIEWERLIB, rel)), rel)


class LiveServer:
    """A real server on a loopback port. Routes are only meaningfully tested through
    the handler: asserting on the helper functions it calls lets a change to the
    handler itself pass unnoticed."""

    def __enter__(self):
        import http.server
        import threading as _t
        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        self.port = self.srv.server_address[1]
        self.thread = _t.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.srv.shutdown()
        self.srv.server_close()
        self.thread.join(timeout=5)

    def get(self, path, method='GET'):
        import http.client
        conn = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        try:
            conn.request(method, path)
            r = conn.getresponse()
            return r.status, r.read(), dict(r.getheaders())
        finally:
            conn.close()


class RawIsUnmodified(unittest.TestCase):
    """/raw must hand back the file byte for byte.

    A sliced .3mf reaches the printer by way of a drop link: it is opened in Bambu
    Studio and printed without re-slicing, because the embedded g-code is the
    preflight-verified artifact. Anything that rewrites or strips the bytes on the way
    out, however well meant, silently destroys that, so this drives the real handler
    rather than the path helpers underneath it.
    """

    def test_served_bytes_match_disk_over_http(self):
        src = make_3mf(os.path.join(server.ROOT, 'printable.3mf'), gcode=True)
        with open(src, 'rb') as fh:
            on_disk = fh.read()
        with LiveServer() as s:
            status, body, headers = s.get('/raw/printable.3mf')
        self.assertEqual(status, 200)
        self.assertEqual(body, on_disk)
        self.assertEqual(int(headers['Content-Length']), len(on_disk))
        with zipfile.ZipFile(io.BytesIO(body)) as z:
            self.assertIn('Metadata/plate_1.gcode', z.namelist())

    def test_head_reports_the_same_length_without_a_body(self):
        make_3mf(os.path.join(server.ROOT, 'headable.3mf'))
        size = os.path.getsize(os.path.join(server.ROOT, 'headable.3mf'))
        with LiveServer() as s:
            status, body, headers = s.get('/raw/headable.3mf', method='HEAD')
        self.assertEqual(status, 200)
        self.assertEqual(body, b'')
        self.assertEqual(int(headers['Content-Length']), size)


class Routes(unittest.TestCase):
    """The routes this server actually exposes, exercised over the wire."""

    @classmethod
    def setUpClass(cls):
        make_3mf(os.path.join(server.ROOT, 'meta.3mf'), thumb=True)
        make_3mf(os.path.join(server.ROOT, 'nothumb.3mf'))

    def test_api_3mf_returns_parsed_metadata(self):
        with LiveServer() as s:
            status, body, _ = s.get('/api/3mf/meta.3mf')
        self.assertEqual(status, 200)
        info = json.loads(body)
        self.assertEqual(info['items'][0]['color'], '#00AE42')
        self.assertTrue(info['sliced'])

    def test_thumb_served_when_present_and_404_when_not(self):
        with LiveServer() as s:
            ok, png, headers = s.get('/thumb/meta.3mf')
            missing, _, _ = s.get('/thumb/nothumb.3mf')
        self.assertEqual(ok, 200)
        self.assertTrue(png.startswith(b'\x89PNG'))
        self.assertEqual(headers['Content-Type'], 'image/png')
        self.assertIn('Last-Modified', headers)
        self.assertEqual(missing, 404)

    def test_routes_confine_and_survive_hostile_paths(self):
        # None of these may escape the root, and none may drop the connection: with
        # keep-alive an escaping exception takes the whole connection down.
        with LiveServer() as s:
            for path in ('/raw/../server.py', '/api/3mf/../../etc/passwd',
                         '/thumb/%00', '/raw/%00', '/api/3mf/%00',
                         '/_viewerlib/../server.py', '/_viewerlib/..%2fserver.py',
                         '/raw/proj//a.txt'):
                status, body, _ = s.get(path)
                self.assertIn(status, (404, 500), path)
                self.assertNotIn(b'VIEWER_HTML', body, path)

    def test_viewerlib_serves_nested_modules(self):
        with LiveServer() as s:
            for rel in ('three.module.js', 'loaders/3MFLoader.js',
                        'libs/fflate.module.js', 'utils/BufferGeometryUtils.js'):
                status, body, _ = s.get('/_viewerlib/' + rel)
                self.assertEqual(status, 200, rel)
                self.assertGreater(len(body), 1000, rel)

    def test_api_3mf_on_a_non_model_is_null_not_an_error(self):
        with LiveServer() as s:
            status, body, _ = s.get('/api/3mf/proj/a.txt')
        self.assertEqual(status, 200)
        self.assertIsNone(json.loads(body))


if __name__ == '__main__':
    unittest.main()
