import ast
import importlib.util
from pathlib import Path
import unittest
import io
import tempfile
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/capture/record-themed.py'
spec = importlib.util.spec_from_file_location('themed', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class OriginalRecorderTests(unittest.TestCase):
    def test_deferred_animation_invalidates_an_early_quiet_checkpoint(self):
        class Browser:
            frame = -1
            def execute_script(self, code):
                if 'busy:document.getAnimations()' in code:
                    return {'busy':self.frame in (11,18), 'mutations':0}
            def capture(self, m):
                self.frame += 1
                return b'frame'
        with tempfile.TemporaryDirectory() as temp:
            output=Path(temp)
            (output/'review').mkdir();(output/'timeline').mkdir()
            browser=Browser()
            scope={'frame':0,'comparison_end':3,'m':browser,'shots':[],
                   'comparison_capture':browser.capture,'ff':type('FF',(),{'stdin':io.BytesIO()})(),
                   'comparison_output':output,'comparison_take':'browser','comparison_shots':[]}
            with patch.object(module.time,'sleep'):
                module.comparison_shot(scope,'Deferred file flight',None,2)
            self.assertGreaterEqual(scope['comparison_shots'][0]['ready'],1.2)
            self.assertEqual(len(scope['comparison_shots'][0]['activity']),40)

    def test_original_cursor_declarations_are_reused_without_running_builder(self):
        tracks, park = module.original_cursor_tracks()
        self.assertEqual(set(tracks), {'browser.mp4', 'controls.mp4', 'details.mp4', 'archive-real.mp4'})
        self.assertEqual(tracks['browser.mp4'][0], (0, park))
        self.assertEqual(tracks['controls.mp4'][0][1], (128, 254))

    def test_all_originals_wrap_without_modification(self):
        for take in ['browser', 'controls', 'details', 'archive-real']:
            original = SCRIPT.with_name(f'record-{take}.py')
            before = original.read_bytes()
            tree = ast.fix_missing_locations(module.RecordingPaths(Path('/tmp/isolated/recordings')).visit(ast.parse(before)))
            compile(tree, str(original), 'exec')
            self.assertEqual(original.read_bytes(), before)
            transformed = ast.unparse(tree)
            self.assertIn('comparison_verify_profile(m)', transformed)
            self.assertIn("comparison_shot(globals(), name, s, duration)", transformed)
            self.assertIn("/tmp/isolated/recordings", transformed)
            self.assertNotIn("DEMO / 'review'", transformed)
            self.assertNotIn("DEMO / 'timeline'", transformed)

    def test_current_archive_source_is_used(self):
        tree = module.RecordingPaths(Path('/tmp/out')).visit(ast.parse("source = Path('payload/arc.uc.js').read_text()"))
        self.assertIn('payload/content/features/archive/auto-archive.js', ast.unparse(tree))


if __name__ == '__main__':
    unittest.main()
