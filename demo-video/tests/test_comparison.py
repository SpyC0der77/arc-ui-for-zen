"""Synchronization and asset validation for the real-footage comparison editor."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SPEC=importlib.util.spec_from_file_location("comparison",Path(__file__).resolve().parents[1]/"scripts/comparison.py")
C=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(C)
ASSEMBLY_SPEC=importlib.util.spec_from_file_location("assembly",Path(__file__).resolve().parents[1]/"scripts/assemble-comparison.py")
A=importlib.util.module_from_spec(ASSEMBLY_SPEC)
ASSEMBLY_SPEC.loader.exec_module(A)


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.manifest=self.root/"manifest.json"

    def tearDown(self):
        self.temp.cleanup()

    def data(self):
        return {"shots":[{"id":"folders","title":"Folders","panels":{
            lane:{"source":f"{lane}.mp4","start":0,"end":3,"ready":ready,
                  "camera":[{"time":0,"rect":[0,0,200,300]}]}
            for lane,ready in zip(C.LANES,(1,1.04,2))}}]}

    def plan(self,data=None,assets=False):
        self.manifest.write_text(json.dumps(data or self.data()))
        return C.load_plan(self.manifest,assets)

    def test_barrier_and_three_second_pause(self):
        plan=self.plan()
        shot=plan["shots"][0]
        self.assertEqual(shot["action_frames"],60)
        self.assertEqual(shot["pause_frames"],90)
        self.assertEqual(shot["total_frames"],150)
        self.assertEqual([shot["panels"][p]["wait_frames"] for p in C.LANES],[30,28,0])
        self.assertEqual([shot["panels"][p]["hold_frames"] for p in C.LANES],[120,118,90])

    def test_offsets_accumulate_without_drift(self):
        data=self.data()
        second=json.loads(json.dumps(data["shots"][0]));second["id"]="next"
        data["shots"].append(second)
        plan=self.plan(data)
        self.assertEqual(plan["shots"][1]["start_frame"],150)
        self.assertEqual(plan["total_frames"],300)

    def test_comparison_cursor_correction_preserves_original_track(self):
        original={'image':'cursor.png','positions':[[0,10,20],[1,20,30]]}
        track=self.root/'cursor.json';track.write_text(json.dumps(original))
        data=self.data();panel=data['shots'][0]['panels']['themed']
        panel.update(cursor_track=str(track),cursor_offset=[20,80])
        result=self.plan(data)['shots'][0]['panels']['themed']['cursor']
        self.assertEqual(result['positions'],[[0,30,100],[1,40,110]])
        self.assertEqual(json.loads(track.read_text()),original)

    def test_missing_footage_fails_check_but_not_plan(self):
        self.plan()
        with self.assertRaisesRegex(ValueError,"missing real-video source"):
            self.plan(assets=True)

    def test_invalid_ranges(self):
        for ready in (0,4,float("nan"),True):
            with self.subTest(ready=ready):
                data=self.data();data["shots"][0]["panels"]["arc"]["ready"]=ready
                with self.assertRaises(ValueError):self.plan(data)

    def test_all_three_lanes_required(self):
        data=self.data();del data["shots"][0]["panels"]["zen"]
        with self.assertRaisesRegex(ValueError,"exactly arc, themed, zen"):self.plan(data)

    def test_camera_requires_correct_aspect_and_order(self):
        data=self.data();data["shots"][0]["panels"]["arc"]["camera"][0]["rect"]=[0,0,1920,1080]
        with self.assertRaisesRegex(ValueError,"aspect 2:3"):self.plan(data)
        data=self.data();data["shots"][0]["panels"]["arc"]["camera"][0]["time"]=.2
        with self.assertRaisesRegex(ValueError,"start at zero"):self.plan(data)

    def test_caption_validation(self):
        data=self.data();data["shots"][0]["panels"]["zen"]["caption"]="x"*101
        with self.assertRaisesRegex(ValueError,"at most 100"):self.plan(data)

    def test_caption_is_visible_in_its_panel_footer(self):
        try:from PIL import Image, ImageChops
        except ImportError:self.skipTest("Pillow required")
        clean=self.root/"clean.png";caption=self.root/"caption.png"
        C.make_background(clean,"Folders")
        C.make_background(caption,"Folders",{"zen":{"caption":"No native equivalent"}})
        difference=ImageChops.difference(Image.open(clean),Image.open(caption))
        self.assertIsNotNone(difference.crop((1280,1028,1880,1080)).getbbox())
        self.assertIsNone(difference.crop((0,0,1280,1080)).getbbox())

    @unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"),"FFmpeg required")
    def test_actual_encode_frame_count_and_early_freeze(self):
        try:import PIL
        except ImportError:self.skipTest("Pillow required for actual label composition")
        # Generated test patterns are testing fixtures, never browser footage.
        video=self.root/"fixture.mp4"
        subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","lavfi","-i","testsrc2=size=320x480:rate=30:duration=0.4","-c:v","libx264","-pix_fmt","yuv420p",str(video)],check=True)
        data=self.data()
        for lane,ready in zip(C.LANES,(.1,.2,.3)):
            p=data["shots"][0]["panels"][lane]
            p.update(source="fixture.mp4",end=.4,ready=ready,camera=[{"time":0,"rect":[0,0,320,480]}])
        plan=self.plan(data,True)
        output=C.render(plan,self.root/"comparison.mp4")
        info=C.probe(output)
        self.assertEqual(int(info["nb_frames"]),99)
        self.assertEqual(info["r_frame_rate"],"30/1")
        # Freeze is visible before the barrier for left panel; all freeze after it.
        raw=subprocess.check_output(["ffmpeg","-v","error","-i",str(output),"-vf","crop=600:900:40:124,select='eq(n,5)+eq(n,8)+eq(n,90)'","-fps_mode","passthrough","-f","rawvideo","-pix_fmt","rgb24","-"])
        size=600*900*3
        self.assertEqual(len(raw),size*3)
        # H264 prediction can introduce tiny quantization differences, so compare MAE.
        a,b,c=raw[:size],raw[size:2*size],raw[2*size:]
        self.assertLess(sum(abs(x-y) for x,y in zip(a,b))/size,.5)
        self.assertLess(sum(abs(x-y) for x,y in zip(a,c))/size,.5)
        moving=subprocess.check_output(["ffmpeg","-v","error","-i",str(output),"-vf","crop=600:900:1280:124,select='eq(n,3)+eq(n,8)'","-fps_mode","passthrough","-f","rawvideo","-pix_fmt","rgb24","-"])
        self.assertEqual(len(moving),size*2)
        self.assertGreater(sum(abs(x-y) for x,y in zip(moving[:size],moving[size:]))/size,1)


class AssemblyTests(unittest.TestCase):
    def test_bottom_controls_survive_space_and_download_zoom(self):
        for name in ('Personal Space','Reading Space','Back to Work','Downloads hover menu'):
            with self.subTest(name=name):
                camera=A.camera_for(name,1920,1080,1,[0,0,720,1080])
                x,y,w,h=camera[-1]['rect']
                self.assertAlmostEqual(y+h,1080)

    def test_flight_camera_follows_launch_toward_native_destination(self):
        camera=A.camera_for('Hidden sidebar download',1920,1080,1.5)
        self.assertGreater(camera[0]['rect'][0],700)
        self.assertEqual(camera[-1]['rect'][0],0)
        self.assertAlmostEqual(sum(camera[-1]['rect'][i] for i in (1,3)),1080)

    def test_native_download_popup_keeps_top_right_edge(self):
        camera=A.camera_for('Downloads hover menu',1920,1080,1,[1200,0,720,1080])
        x,y,w,h=camera[-1]['rect']
        self.assertEqual(y,0)
        self.assertAlmostEqual(x+w,1920)

    def test_editorial_camera_override_is_pinned_to_source(self):
        metadata=self.meta('Library Spaces');cache={}
        override={'source_suffix':'actual.mp4','keyframes':[{'time':0,'rect':[442,0,720,1080]},{'time':.8,'rect':[756,0,720,1080]}]}
        with patch.object(A.COMPARISON,'probe',return_value={'width':1920,'height':1080,'duration':3.5}):
            result=A.panel(metadata,self.root,'Library Spaces',cache,override)
            self.assertEqual(result['camera'],override['keyframes'])
            override['source_suffix']='different-take.mp4'
            result=A.panel(metadata,self.root,'Library Spaces',cache,override)
            self.assertNotEqual(result['camera'],override['keyframes'])

    def test_incomplete_native_capture_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'recording is incomplete'):
            A.index_shots({'completed':False,'shots':[]}, 'Zen')

    def test_recorder_focus_rect_stays_at_constant_zoom(self):
        camera=A.camera_for('Folders',1920,1080,1,[0,0,720,1080])
        self.assertEqual(camera[0]['rect'],[0,0,720,1080])
        self.assertEqual(camera,[{'time':0,'rect':[0,0,720,1080]}])

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        self.timeline=self.root/"original";self.themed=self.root/"themed"
        self.timeline.mkdir();(self.themed/"timeline").mkdir(parents=True)
        self.arc=self.root/"arc.json";self.zen=self.root/"zen.json"
        self.video=self.root/"actual.mp4";self.video.touch()
        self.names=["Work space, Essentials and real documentation","Collapsed folder"]
        self.write(self.timeline/"edit.json",{"segments":[["browser.mp4",0,3.5],["controls.mp4",0,3.5]]})
        for take,filename in A.TAKES.items():
            name=self.names[0] if take=="browser" else self.names[1]
            self.write(self.timeline/filename,[{"name":name,"start":0,"duration":3.5}])
            self.write(self.themed/"timeline"/f"{take}-checkpoints.json",{"shots":[self.meta(name)]})
        for file in (self.arc,self.zen):self.write(file,{"shots":[self.meta(n) for n in self.names]})

    def tearDown(self):self.temp.cleanup()

    def write(self,path,data):path.write_text(json.dumps(data))

    def meta(self,name):
        return {"name":name,"source":str(self.video),"start":0,"end":3.5,"ready":1,
                "camera":[0,0,720,1080],"availability":"native"}

    def assemble(self):
        with patch.object(A.COMPARISON,"probe",return_value={"width":1920,"height":1080,"duration":3.5}):
            return A.assemble(self.themed,self.arc,self.zen,self.timeline)

    def test_preserves_retained_browser_order(self):
        result=self.assemble()
        self.assertEqual([s["title"] for s in result["shots"]],self.names)
        self.assertEqual(set(result["shots"][0]["panels"]),set(C.LANES))

    def test_original_onboarding_is_omitted_from_comparison(self):
        self.write(self.timeline/'edit.json',{'segments':[['onboarding.mp4',0,19],['browser.mp4',0,3.5]]})
        self.assertEqual([s['title'] for s in self.assemble()['shots']], [self.names[0]])

    def test_missing_native_feature_is_error(self):
        self.write(self.arc,{"shots":[self.meta(self.names[0])]})
        with self.assertRaisesRegex(ValueError,"Arc: missing.*Collapsed folder"):self.assemble()

    def test_unavailable_footage_gets_visible_caption(self):
        data={"shots":[self.meta(n) for n in self.names]}
        data["shots"][0]["availability"]="unavailable"
        self.write(self.zen,data)
        result=self.assemble()
        self.assertEqual(result["shots"][0]["panels"]["zen"]["caption"],"No native equivalent")

    def test_nonexistent_recording_is_error(self):
        self.video.unlink()
        with self.assertRaisesRegex(ValueError,"Missing real-video source"):self.assemble()

    def test_missing_ready_checkpoint_is_error(self):
        data={"shots":[self.meta(n) for n in self.names]};del data["shots"][0]["ready"]
        self.write(self.arc,data)
        with self.assertRaisesRegex(ValueError,"missing measured ready"):self.assemble()


if __name__=="__main__":unittest.main()
