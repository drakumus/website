"""Path-confinement and tree tests for the drop server. Run: python3 -m unittest"""
import os
import tempfile
import unittest

os.environ.setdefault('DROP_ROOT', tempfile.mkdtemp(prefix='drop-test-'))
import server


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

    def test_absolute_style_stays_confined(self):
        # "/etc/passwd" is treated as root-relative "etc/passwd", which does not exist
        resolved = server.resolve('/etc/passwd')
        self.assertTrue(resolved is None or resolved.startswith(self.root))


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


if __name__ == '__main__':
    unittest.main()
