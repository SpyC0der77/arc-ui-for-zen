"""Timing, cursor easing and end-to-end encode checks for the polished renderer.

Requires Pillow and NumPy (skipped otherwise); the encode test also needs ffmpeg.
"""
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
try:
    import polished as P
except ImportError as exc:  # Pillow/NumPy missing
    P = None
    REASON = str(exc)


@unittest.skipIf(P is None, "Pillow and NumPy are required")
class CursorTests(unittest.TestCase):
    def test_whole_move_is_eased_and_monotone(self):
        path = P.CursorPath([[0, 1000, 500], [.2, 800, 450], [.4, 300, 300], [.6, 100, 200], [1, 100, 200]])
        xs = [path.at(i / 100)[0] for i in range(0, 101)]
        self.assertEqual(xs[0], 1000)
        self.assertEqual(xs[-1], 100)
        self.assertTrue(all(b <= a + 1e-6 for a, b in zip(xs, xs[1:])), "cursor must not double back")
        # Eased: slow start and end, no stop at intermediate samples.
        self.assertLess(1000 - xs[3], 15)
        self.assertGreater(abs(xs[30] - xs[29]), 20)

    def test_rest_points_hold(self):
        path = P.CursorPath([[0, 10, 10], [.5, 10, 10], [1, 50, 10], [2, 50, 10]])
        self.assertEqual(path.at(.3), (10, 10))
        self.assertEqual(tuple(round(v) for v in path.at(1.5)), (50, 10))


@unittest.skipIf(P is None, "Pillow and NumPy are required")
class HumanizeTests(unittest.TestCase):
    def test_recorder_flick_becomes_glide_before_the_feature(self):
        # Arc takes park the pointer at PARK and flick it ~1700px in half a second.
        track, approach = P.humanize((100, 100), [[0, *P.PARK], [.25, 900, 700], [.5, 40, 480], [1.5, 40, 480]], 1.3)
        self.assertIsNotNone(approach)
        self.assertEqual(approach[1], (40, 480))
        self.assertGreaterEqual(approach[2], P.natural_duration(math.dist((100, 100), (40, 480))) - 1e-9)
        self.assertEqual(track.at(0), (40, 480))
        self.assertEqual(track.moves, [])

    def test_drag_keeps_departure_and_never_starts_late(self):
        track, approach = P.humanize((277, 600), [[0, 277, 600], [.27, 345, 600]], 1.3)
        self.assertIsNone(approach)
        (t0, t1, _, _), = track.moves
        self.assertEqual(t0, 0)
        self.assertGreaterEqual(t1, .27)

    def test_late_first_arrival_stays_on_time(self):
        track, approach = P.humanize((1500, 900), [[0, *P.PARK], [2.28, 10, 640], [3, 10, 640]], 1.3)
        self.assertIsNone(approach)
        (t0, t1, _, _), = track.moves
        self.assertAlmostEqual(t1, 2.28)
        self.assertGreater(t0, 1)


@unittest.skipIf(P is None or not shutil.which("ffmpeg"), "renderer dependencies missing")
class RenderTests(unittest.TestCase):
    def test_synchronised_shot_frame_count(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for lane, color in zip(P.LANES, ("red", "green", "blue")):
                subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"color={color}:s=1920x1080:r=30:d=2",
                                "-pix_fmt", "yuv420p", str(root / f"{lane}.mp4")], check=True)
            ready = {"arc": 1.0, "themed": .5, "zen": 1.5}
            manifest = root / "m.json"
            manifest.write_text(json.dumps({"shots": [{"id": "folders", "title": "Folders", "panels": {
                lane: {"source": f"{lane}.mp4", "start": 0, "end": 2, "ready": ready[lane],
                       "camera": [{"time": 0, "rect": [0, 0, 720, 1080]}]} for lane in P.LANES}}]}))
            out, n = P.render(manifest, root / "out.mp4", intro=False, outro=False, preset="ultrafast")
            expected = round(P.LEAD_FIRST * P.FPS) + math.ceil(1.5 * P.FPS) + round(P.HOLD_LAST * P.FPS)
            self.assertEqual(n, expected)
            probe = subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-show_entries",
                                             "stream=nb_read_frames,r_frame_rate", "-of", "json", str(out)], text=True)
            stream = json.loads(probe)["streams"][0]
            self.assertEqual(int(stream["nb_read_frames"]), expected)
            self.assertEqual(stream["r_frame_rate"], "60/1")


if __name__ == "__main__":
    unittest.main()
