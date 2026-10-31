"""Code-only Arc recording from a verified, dedicated demo-window recipe.

Compile mac-native.swift once, then pass --helper /path/to/mac-native.
--example prints a deliberately UNVERIFIED skeleton; it cannot be recorded.
--check validates the recipe and native permissions without contacting Arc.

A recipe contains window_id, demo_marker, verified=true, evidence (how actions
were checked), initial_pointer:[normalized x,y], window_guard and shots.
window_guard and each shot.ready contain verified=true, evidence, command:[argv]
and timeout. Commands must observe the actual native UI, and print JSON:
 {"ready":true,"window_id":123,"demo_marker":"arc-demo-only",
  "feature_id":"folders","frontmost":true}
The guard uses feature_id="window-guard" and must verify the marker is visible
in that dedicated window. Mere elapsed time is never treated as completion.

Shot: {id,name,camera:[x,y,w,h],actions:[{at,kind,...}],ready:{...}}.
Actions: move {to:[nx,ny],duration}, click {to:[nx,ny]}, key {keycode,modifiers}.
All coordinates are normalized within the verified window. Mouse motion uses
smoothstep. A shot may reference a verified cursor_track JSON with normalized
positions [[seconds,x,y],...] and image; those recorded timings drive the mouse
and are exported at 1920x1080 for the comparison compositor. No positions or
completion checkpoints are guessed. No built-in computer-use tools are used.
"""
import argparse
import concurrent.futures
import json
import math
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import time

FPS=20
WIDTH,HEIGHT=1920,1080


def finite(value,context):
    if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value):
        raise ValueError(f"{context}: expected finite number")
    return value


def point(value,context):
    if not isinstance(value,list) or len(value)!=2:
        raise ValueError(f"{context}: need normalized [x,y]")
    if any(not 0<=finite(v,context)<=1 for v in value):
        raise ValueError(f"{context}: normalized coordinates must be 0..1")
    return value


def verified_command(spec,context):
    if not isinstance(spec,dict) or spec.get("verified") is not True or not isinstance(spec.get("evidence"),str) or not spec["evidence"].strip() or "TODO" in spec["evidence"]:
        raise ValueError(f"{context}: requires verified native observation and evidence; TODO recipes cannot record")
    command=spec.get("command")
    if not isinstance(command,list) or not command or any(not isinstance(x,str) or not x for x in command):
        raise ValueError(f"{context}: command must be a nonempty argv array")
    timeout=finite(spec.get("timeout",15),context)
    if not 0<timeout<=120:
        raise ValueError(f"{context}: timeout must be in (0,120]")


def load_recipe(path,window_id):
    path=Path(path).resolve()
    data=json.loads(path.read_text())
    if data.get("verified") is not True or not isinstance(data.get("evidence"),str) or not data["evidence"].strip() or "TODO" in data["evidence"]:
        raise ValueError("Recipe is unverified; record only actions checked against the actual dedicated Arc window")
    if data.get("window_id")!=window_id or window_id<=0:
        raise ValueError("Explicit --window-id must match recipe's dedicated Arc window_id")
    marker=data.get("demo_marker")
    if not isinstance(marker,str) or len(marker)<8 or "TODO" in marker:
        raise ValueError("Recipe requires a unique demo_marker visible in its dedicated demo window")
    point(data.get("initial_pointer"),"initial_pointer")
    verified_command(data.get("window_guard"),"window_guard")
    shots=data.get("shots")
    if not isinstance(shots,list) or not shots:
        raise ValueError("Recipe requires verified feature shots")
    seen=set()
    for shot in shots:
        name=shot.get("id")
        if not isinstance(name,str) or not name or name in seen or not shot.get("name"):
            raise ValueError("Shot requires unique id and original feature name")
        seen.add(name)
        if shot.get("verified") is not True or not isinstance(shot.get("evidence"),str) or not shot["evidence"].strip() or "TODO" in shot["evidence"]:
            raise ValueError(f"{name}: feature actions must have verification evidence")
        verified_command(shot.get("ready"),f"{name}.ready")
        camera=shot.get("camera")
        if not isinstance(camera,list) or len(camera)!=4:
            raise ValueError(f"{name}: camera must be [x,y,width,height] in the 1920x1080 recording")
        x,y,w,h=[finite(v,f"{name}.camera") for v in camera]
        if min(x,y)<0 or min(w,h)<=0 or x+w>WIDTH or y+h>HEIGHT or abs(w/h-2/3)>.001:
            raise ValueError(f"{name}: camera must fit 1920x1080 and have 2:3 aspect")
        actions=shot.get("actions")
        if not isinstance(actions,list) or not actions:
            raise ValueError(f"{name}: explicit verified actions required (no placeholder footage)")
        prior=-1
        occupied_until=0
        for action in actions:
            at=finite(action.get("at"),f"{name}.action.at")
            if at<0 or at<prior:
                raise ValueError(f"{name}: actions must have increasing nonnegative times")
            if at<occupied_until-1e-8:
                raise ValueError(f"{name}: action overlaps an unfinished move; split movement around clicks")
            prior=at
            kind=action.get("kind")
            if kind in ("move","click"):
                point(action.get("to"),f"{name}.{kind}")
                if kind=="move" and finite(action.get("duration",0),f"{name}.duration")<0:
                    raise ValueError(f"{name}: move duration cannot be negative")
                if kind=="move":occupied_until=at+action.get("duration",0)
            elif kind=="key":
                if isinstance(action.get("keycode"),bool) or not isinstance(action.get("keycode"),int) or not 0<=action["keycode"]<=127:
                    raise ValueError(f"{name}: key needs native hardware keycode 0..127")
                if not isinstance(action.get("modifiers",[]),list) or any(m not in ("cmd","shift","option","control") for m in action.get("modifiers",[])):
                    raise ValueError(f"{name}: invalid key modifiers")
            else:
                raise ValueError(f"{name}: unknown action kind {kind}")
        if shot.get("cursor_track"):
            if any(a["kind"]=="move" for a in actions):
                raise ValueError(f"{name}: matched cursor track and move actions conflict")
            trackpath=(path.parent/shot["cursor_track"]).resolve()
            track=json.loads(trackpath.read_text())
            if track.get("coordinate_space")!="normalized" or track.get("verified") is not True or not track.get("evidence"):
                raise ValueError(f"{name}: matched cursor track requires verified normalized source data")
            prior=-1
            for position in track.get("positions",[]):
                if not isinstance(position,list) or len(position)!=3:
                    raise ValueError(f"{name}: cursor positions must be [time,nx,ny]")
                at=finite(position[0],f"{name}.cursor.time");point(position[1:],f"{name}.cursor")
                if at<0 or at<=prior:raise ValueError(f"{name}: cursor times must increase")
                prior=at
            if prior<0 or track["positions"][0][0]!=0:
                raise ValueError(f"{name}: cursor track must start at zero")
            image=(trackpath.parent/track.get("image","")).resolve()
            if not image.is_file():raise ValueError(f"{name}: missing cursor image")
            track["image"]=str(image);shot["cursor"]=track
    return data


def observe(spec,recipe,feature):
    replacements={"{window_id}":str(recipe["window_id"]),"{demo_marker}":recipe["demo_marker"],"{feature_id}":feature}
    argv=[]
    for arg in spec["command"]:
        for token,value in replacements.items():arg=arg.replace(token,value)
        argv.append(arg)
    try:
        raw=subprocess.check_output(argv,text=True,timeout=min(spec.get("timeout",15),5),stderr=subprocess.DEVNULL)
        result=json.loads(raw)
    except (OSError,subprocess.SubprocessError,ValueError):
        return False
    return (isinstance(result,dict) and result.get("ready") is True and
            result.get("window_id")==recipe["window_id"] and
            result.get("demo_marker")==recipe["demo_marker"] and
            result.get("feature_id")==feature and result.get("frontmost") is True)


def permissions(helper):
    result=json.loads(subprocess.check_output([str(helper),"probe"],text=True,timeout=10))
    missing=[key for key in ("accessibility","screenRecording") if result.get(key) is not True]
    if missing:
        raise RuntimeError("Enable "+" and ".join(missing)+" for the launching terminal/app in System Settings > Privacy & Security, then retry --check")
    return result


def due_frames(elapsed):
    return math.floor(max(0,elapsed)*FPS)+1


def cursor_actions(positions):
    """Nonblocking motion samples allow native clicks during a cursor segment."""
    actions=[{"kind":"move","to":positions[0][1:],"at":positions[0][0],"duration":0}]
    for a,b in zip(positions,positions[1:]):
        count=max(1,math.ceil((b[0]-a[0])*30))
        for step in range(1,count+1):
            u=step/count;smooth=u*u*(3-2*u)
            actions.append({"kind":"move","at":a[0]+(b[0]-a[0])*u,"duration":0,
                            "to":[a[i]+(b[i]-a[i])*smooth for i in (1,2)]})
    return actions


class Recorder:
    def __init__(self,helper,recipe,output):
        self.helper=str(helper);self.recipe=recipe;self.output=Path(output).resolve()
        if self.output.exists() or self.output.with_suffix(".json").exists():
            raise ValueError("Refusing to overwrite existing Arc capture or metadata")
        self.position=recipe["initial_pointer"][:]
        self.shots=[];self.frames=0

    def native(self,*args):
        subprocess.run([self.helper,*map(str,args)],check=True,stdout=subprocess.DEVNULL,timeout=10)

    def guard(self):
        if not observe(self.recipe["window_guard"],self.recipe,"window-guard"):
            raise RuntimeError("Dedicated Arc demo window marker/frontmost guard failed; no further input or capture permitted")

    def pixel(self,normalized):
        b=self.bounds
        return b["X"]+normalized[0]*b["Width"],b["Y"]+normalized[1]*b["Height"]

    def move(self,target,duration):
        initial=self.position[:];start=time.monotonic()
        while True:
            u=min(1,(time.monotonic()-start)/duration) if duration else 1
            smooth=u*u*(3-2*u)
            self.native("move",*self.pixel([initial[i]+(target[i]-initial[i])*smooth for i in range(2)]))
            if u>=1:break
            time.sleep(1/30)
        self.position=target[:]

    def act(self,shot,started):
        actions=list(shot["actions"])
        if shot.get("cursor"):
            actions += cursor_actions(shot["cursor"]["positions"])
            actions.sort(key=lambda a:a["at"])
        for action in actions:
            delay=started+action["at"]-time.monotonic()
            if delay>0:time.sleep(delay)
            self.guard()
            if time.monotonic()-started-action["at"]>.25:
                raise RuntimeError(f"{shot['name']}: native input missed the verified timing by over 250ms; re-record instead of retiming footage")
            if action["kind"]=="move":self.move(action["to"],action.get("duration",0))
            elif action["kind"]=="click":
                self.native("click",*self.pixel(action["to"]));self.position=action["to"][:]
            else:self.native("key",action["keycode"],*action.get("modifiers",[]))
        deadline=time.monotonic()+shot["ready"].get("timeout",15)
        while time.monotonic()<deadline:
            self.guard()
            if observe(shot["ready"],self.recipe,shot["id"]):return time.monotonic()-started
            time.sleep(.1)
        raise RuntimeError(f"{shot['name']}: native readiness predicate never succeeded; timing was not guessed")

    def record(self):
        self.guard()
        windows=json.loads(subprocess.check_output([self.helper,"windows","company.thebrowser.Browser"],text=True,timeout=10))
        window=next((w for w in windows if w["id"]==self.recipe["window_id"]),None)
        if not window:raise RuntimeError("Explicit dedicated window ID is not a current Arc window; rediscover and verify recipe")
        self.bounds=window["bounds"]
        if abs(self.bounds["Width"]/self.bounds["Height"]-WIDTH/HEIGHT)>.01:
            raise RuntimeError("Resize the dedicated Arc demo window to a 16:9 aspect ratio before recording; capture will not stretch it")
        self.output.parent.mkdir(parents=True,exist_ok=True)
        ff=subprocess.Popen(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","image2pipe","-framerate",str(FPS),"-vcodec","png","-i","-","-vf",f"scale={WIDTH}:{HEIGHT}:flags=lanczos,fps=30","-an","-c:v","libx264","-preset","fast","-crf","17","-pix_fmt","yuv420p","-movflags","+faststart",str(self.output)],stdin=subprocess.PIPE)
        complete=False
        try:
            self.native("move",*self.pixel(self.position))
            with tempfile.TemporaryDirectory(prefix="arc-native-capture-") as temp,concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                imagefile=Path(temp)/"frame.png"
                for shot in self.recipe["shots"]:
                    self.guard();startframe=self.frames;started=time.monotonic();count=0;previous=None;ready=None
                    future=executor.submit(self.act,shot,started)
                    while ready is None or time.monotonic()-started<ready+.15:
                        if future.done():ready=future.result()
                        self.guard()
                        subprocess.run(["screencapture","-x","-o","-l",str(self.recipe["window_id"]),str(imagefile)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
                        current=imagefile.read_bytes()
                        target=due_frames(time.monotonic()-started)
                        # Preserve elapsed wall time when screenshot acquisition is slow.
                        # Earlier frames repeat the last observed image; no time compression.
                        while count<target-1:
                            ff.stdin.write(previous or current);count+=1;self.frames+=1
                        ff.stdin.write(current);count+=1;self.frames+=1;previous=current
                        delay=started+count/FPS-time.monotonic()
                        if delay>0:time.sleep(delay)
                    metadata={"id":shot["id"],"name":shot["name"],"source":str(self.output),
                              "start":startframe/FPS,"end":self.frames/FPS,
                              "ready":math.ceil(ready*30)/30,"camera":shot["camera"],
                              "availability":shot.get("availability","native"),"notes":shot.get("notes","")}
                    if shot.get("caption"):metadata["caption"]=shot["caption"]
                    if shot.get("cursor"):
                        cursorpath=self.output.with_name(f"{self.output.stem}-{shot['id']}-cursor.json")
                        cursorpath.write_text(json.dumps({"image":shot["cursor"]["image"],"positions":[[t,round(x*WIDTH),round(y*HEIGHT)] for t,x,y in shot["cursor"]["positions"]]},indent=2))
                        metadata["cursor_track"]=str(cursorpath)
                    self.shots.append(metadata)
                    print(f"Captured {shot['name']} (native checkpoint {ready:.3f}s)",flush=True)
            complete=True
        finally:
            ff.stdin.close()
            status=ff.wait()
            destination=self.output.with_suffix(".json" if complete and status==0 else ".partial.json")
            destination.write_text(json.dumps({"fps":30,"width":WIDTH,"height":HEIGHT,"complete":complete and status==0,"shots":self.shots},indent=2)+"\n")
            if status!=0:raise RuntimeError("Arc FFmpeg encoding failed")


def example():
    observer={"verified":False,"evidence":"TODO verify native UI observer","command":["TODO-native-observer","{window_id}","{demo_marker}","{feature_id}"],"timeout":15}
    return {"verified":False,"evidence":"TODO verify dedicated Arc demo actions","window_id":0,"demo_marker":"TODO-demo-only-marker", "initial_pointer":[.8,.8],"window_guard":observer,"shots":[{"id":"collapsed-folder","name":"Collapsed folder","verified":False,"evidence":"TODO inspect real Arc folder control","camera":[0,0,720,1080],"actions":[],"ready":observer}]}


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--example",action="store_true")
    parser.add_argument("--check",action="store_true")
    parser.add_argument("--recipe",type=Path)
    parser.add_argument("--window-id",type=int)
    parser.add_argument("--helper",type=Path)
    parser.add_argument("--output",type=Path,default=Path("demo-video/recordings/comparison/arc.mp4"))
    args=parser.parse_args()
    if args.example:print(json.dumps(example(),indent=2));return
    try:
        if not args.recipe or not args.window_id or not args.helper:
            raise ValueError("Pass --recipe, explicit dedicated --window-id, and compiled --helper")
        recipe=load_recipe(args.recipe,args.window_id)
        if platform.system()!="Darwin":raise ValueError("Arc native recorder requires macOS")
        for executable in ("ffmpeg","screencapture"):
            if not shutil.which(executable):raise ValueError(f"{executable} is required on PATH")
        permissions(args.helper)
        if args.check:print("Verified recipe and native permissions pass; no Arc actions performed");return
        Recorder(args.helper,recipe,args.output).record()
    except (ValueError,OSError,RuntimeError,subprocess.SubprocessError) as exc:
        parser.exit(1,f"Arc capture error: {exc}\n")


if __name__=="__main__":main()
