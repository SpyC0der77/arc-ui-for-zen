import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location("record_arc",Path(__file__).resolve().parents[1]/"scripts/capture/record-arc.py")
A=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(A)


class ArcRecipeTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/"recipe.json"
    def tearDown(self):self.temp.cleanup()
    def recipe(self):
        command={"verified":True,"evidence":"Actual native AX observer checked manually", "command":["native-observer","{window_id}","{demo_marker}","{feature_id}"],"timeout":2}
        return {"verified":True,"evidence":"Controls checked in dedicated sample workspace","window_id":123,"demo_marker":"arc-demo-only","initial_pointer":[.8,.8],"window_guard":command,"shots":[{"id":"folders","name":"Collapsed folder","verified":True,"evidence":"Control checked on screen","camera":[0,0,720,1080],"actions":[{"kind":"click","at":.2,"to":[.1,.2]}],"ready":command}]}
    def load(self,data):self.path.write_text(json.dumps(data));return A.load_recipe(self.path,123)
    def test_verified_recipe_validates_without_app_operations(self):self.assertEqual(self.load(self.recipe())["window_id"],123)
    def test_unverified_example_rejected(self):
        with self.assertRaisesRegex(ValueError,"unverified"):self.load(A.example())
    def test_explicit_window_identity_required(self):
        data=self.recipe();data["window_id"]=456
        with self.assertRaisesRegex(ValueError,"dedicated Arc window_id"):self.load(data)
    def test_no_missing_actions_or_ready_predicate(self):
        for key in ("actions","ready"):
            data=self.recipe();del data["shots"][0][key]
            with self.assertRaises(ValueError):self.load(data)
    def test_camera_bounds_and_normalized_mouse(self):
        data=self.recipe();data["shots"][0]["actions"][0]["to"]=[-1,0]
        with self.assertRaisesRegex(ValueError,"normalized"):self.load(data)
    def test_elapsed_time_resampling_never_compresses_slow_grabs(self):
        self.assertEqual(A.due_frames(0),1)
        self.assertEqual(A.due_frames(.1),3)
        self.assertEqual(A.due_frames(2),41)
    def test_matched_cursor_motion_is_nonblocking_and_preserves_keys(self):
        actions=A.cursor_actions([[0,.1,.2],[1,.8,.9]])
        self.assertEqual(actions[0]["to"],[.1,.2])
        self.assertAlmostEqual(actions[-1]["to"][0],.8)
        self.assertAlmostEqual(actions[-1]["to"][1],.9)
        self.assertEqual(actions[-1]["at"],1)
        self.assertTrue(all(a["duration"]==0 for a in actions))
        self.assertTrue(any(a["at"]==.5 for a in actions))
    def test_checkpoint_requires_window_marker_and_feature(self):
        data=self.recipe();spec=data["window_guard"]
        result={"ready":True,"window_id":123,"demo_marker":"arc-demo-only","feature_id":"folders","frontmost":True}
        with patch.object(A.subprocess,"check_output",return_value=json.dumps(result)):
            self.assertTrue(A.observe(spec,data,"folders"))
            self.assertFalse(A.observe(spec,data,"wrong-feature"))
        result["window_id"]=456
        with patch.object(A.subprocess,"check_output",return_value=json.dumps(result)):
            self.assertFalse(A.observe(spec,data,"folders"))
    def test_plain_command_success_is_not_native_readiness(self):
        data=self.recipe()
        with patch.object(A.subprocess,"check_output",return_value="true"):
            self.assertFalse(A.observe(data["window_guard"],data,"window-guard"))
    def test_permissions_error_is_actionable(self):
        with patch.object(A.subprocess,"check_output",return_value='{"accessibility":false,"screenRecording":true}'):
            with self.assertRaisesRegex(RuntimeError,"System Settings > Privacy & Security"):
                A.permissions("unused-helper")


if __name__=="__main__":unittest.main()
