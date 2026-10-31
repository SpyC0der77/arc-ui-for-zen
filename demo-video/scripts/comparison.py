"""Frame-exact comparison editor for real browser recordings; never launches a browser.

Manifest: {"shots": [{"id": "folders", "title": "Folders", "panels": {
 "arc": {"source": "arc.mp4", "start": 0, "end": 5, "ready": 2,
         "camera": [{"time": 0, "rect": [0,0,600,900]}]},
 "themed": {...}, "zen": {...}}}]}. Paths are relative to the manifest.
Camera rectangles use source pixels, have a 2:3 aspect ratio, and may smoothly
move/zoom between keyframes. Time is relative to each source range. Optional
cursor_track references {"positions": [[seconds,x,y], ...], "image": "cursor.png"}
with times relative to the range start; cursor pixels are composited before zoom.
The last ready frame is held until the slowest panel arrives, then all hold 3s.
"""
import argparse
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

FPS = 30
LANES = ("arc", "themed", "zen")
LABELS = ("Arc", "Arc UI for Zen", "Vanilla Zen")
PANEL_W, PANEL_H = 600, 900


def number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return value


def frames(seconds):
    return math.ceil(seconds * FPS - 1e-8)


def probe(path):
    result = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,nb_frames:format=duration", "-of", "json", str(path)], text=True)
    data = json.loads(result)
    if not data.get("streams"):
        raise ValueError(f"No video stream: {path}")
    return {**data["streams"][0], "duration": float(data["format"]["duration"])}


def load_plan(manifest, require_assets=False):
    manifest = Path(manifest).resolve()
    data = json.loads(manifest.read_text())
    if not isinstance(data, dict):
        raise ValueError("Manifest must be an object")
    shots = data.get("shots")
    if not isinstance(shots, list) or not shots:
        raise ValueError("Manifest needs a nonempty shots array")
    result, offset, seen, probes = [], 0, set(), {}
    for index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            raise ValueError(f"Shot {index} must be an object")
        name = shot.get("id", str(index))
        if not isinstance(name, str) or not name:
            raise ValueError(f"Shot {index} needs a nonempty string id")
        if name in seen:
            raise ValueError(f"Duplicate shot id: {name}")
        seen.add(name)
        if not isinstance(shot.get("title"), str) or not shot["title"].strip():
            raise ValueError(f"{name}: missing feature title")
        if set(shot.get("panels", {})) != set(LANES):
            raise ValueError(f"{name}: panels must contain exactly arc, themed, zen")
        panels = {}
        for lane in LANES:
            p = dict(shot["panels"][lane])
            context = f"{name}/{lane}"
            caption=p.get("caption", "")
            if not isinstance(caption,str) or len(caption)>100 or "\n" in caption:
                raise ValueError(f"{context}: caption must be a single line of at most 100 characters")
            if not isinstance(p.get("source"), str) or not p["source"]:
                raise ValueError(f"{context}: missing real-video source")
            source = (manifest.parent / p["source"]).resolve()
            start = number(p.get("start", 0), f"{context}.start")
            end = number(p.get("end"), f"{context}.end")
            ready = number(p.get("ready", end-start), f"{context}.ready")
            if start < 0 or end <= start or ready <= 0 or ready > end-start + 1e-8:
                raise ValueError(f"{context}: require 0 <= start < end and 0 < ready <= end-start")
            ready_frames = frames(ready)
            if ready_frames / FPS > end-start + 1/FPS + 1e-8:
                raise ValueError(f"{context}: source range too short for ready frame")
            camera = p.get("camera")
            if not isinstance(camera, list) or not camera:
                raise ValueError(f"{context}: camera keyframes are required")
            previous = -1
            for key in camera:
                t = number(key.get("time"), f"{context}.camera.time")
                rect = key.get("rect")
                if t < 0 or t <= previous or t > ready or (previous == -1 and t != 0):
                    raise ValueError(f"{context}: camera times must start at zero and increase through ready")
                previous = t
                if not isinstance(rect, list) or len(rect) != 4:
                    raise ValueError(f"{context}: camera rect must be [x,y,width,height]")
                x,y,w,h = [number(v, f"{context}.camera.rect") for v in rect]
                if min(x,y) < 0 or min(w,h) <= 0 or abs(w/h-PANEL_W/PANEL_H) > .001:
                    raise ValueError(f"{context}: camera must be positive, nonnegative origin, aspect 2:3")
            p.update(source=str(source), start=start, end=end, ready=ready,
                     ready_frames=ready_frames)
            track = p.get("cursor_track")
            if track:
                trackpath = (manifest.parent / track).resolve()
                if not trackpath.is_file():
                    raise ValueError(f"{context}: missing cursor track: {trackpath}")
                cursor = json.loads(trackpath.read_text())
                points = cursor.get("positions", [])
                prior = -1
                for point in points:
                    if not isinstance(point, list) or len(point) != 3:
                        raise ValueError(f"{context}: cursor points must be [seconds,x,y]")
                    t,x,y = [number(v, f"{context}.cursor") for v in point]
                    if t < 0 or t <= prior:
                        raise ValueError(f"{context}: cursor times must increase")
                    prior = t
                if not points or points[0][0] != 0 or not cursor.get("image"):
                    raise ValueError(f"{context}: cursor needs points starting at zero and an image")
                cursor_delta=p.get('cursor_offset',[0,0])
                if not isinstance(cursor_delta,list) or len(cursor_delta)!=2:
                    raise ValueError(f'{context}: cursor_offset must be [x,y]')
                dx,dy=[number(v,f'{context}.cursor_offset') for v in cursor_delta]
                cursor['positions']=[[t,x+dx,y+dy] for t,x,y in points]
                cursor["image"] = str((trackpath.parent / cursor["image"]).resolve())
                if require_assets and not Path(cursor["image"]).is_file():
                    raise ValueError(f"{context}: missing cursor image: {cursor['image']}")
                p["cursor"] = cursor
            if require_assets:
                if not source.is_file():
                    raise ValueError(f"{context}: missing real-video source: {source}")
                info = probes.setdefault(str(source), None)
                if info is None:
                    info = probes[str(source)] = probe(source)
                if end > info["duration"] + 1/FPS:
                    raise ValueError(f"{context}: range ends beyond source duration")
                for key in camera:
                    x,y,w,h = key["rect"]
                    if x+w > info["width"]+.01 or y+h > info["height"]+.01:
                        raise ValueError(f"{context}: camera rectangle exceeds source bounds")
                    canvas_w=math.ceil(max(info["width"], info["height"]*PANEL_W/PANEL_H)/2)*2
                    if w < canvas_w/10:
                        raise ValueError(f"{context}: camera exceeds zoompan's 10x zoom limit")
                p["width"],p["height"] = info["width"],info["height"]
            panels[lane] = p
        action = max(p["ready_frames"] for p in panels.values())
        total = action + 3*FPS
        for p in panels.values():
            p["wait_frames"] = action-p["ready_frames"]
            p["hold_frames"] = total-p["ready_frames"]
        result.append(dict(id=name, title=shot["title"], start_frame=offset,
                           action_frames=action, pause_frames=3*FPS, total_frames=total, panels=panels))
        offset += total
    return dict(fps=FPS, width=1920, height=1080, total_frames=offset,
                duration=offset/FPS, shots=result)


def curve(keys, coordinate, clock):
    """Piecewise smoothstep, clamped outside authored keyframes."""
    value = f"{keys[-1][1][coordinate]:.8f}"
    for (a, av), (b, bv) in reversed(list(zip(keys, keys[1:]))):
        u = f"clip(({clock}-{a:.8f})/{b-a:.8f},0,1)"
        smooth = f"({u}*{u}*(3-2*{u}))"
        value = f"if(lt({clock},{b:.8f}),{av[coordinate]:.8f}+({bv[coordinate]-av[coordinate]:.8f})*{smooth},{value})"
    return value


def make_background(path, title, panels=None):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as exc:
        raise RuntimeError("Rendering labels requires Pillow: install it into your chosen Python environment") from exc
    candidates = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "C:/Windows/Fonts/segoeui.ttf"]
    fontpath = next((p for p in candidates if Path(p).is_file()), None)
    def font(size):
        return ImageFont.truetype(fontpath, size) if fontpath else ImageFont.load_default(size=size)
    image = Image.new("RGB", (1920,1080), "#101218")
    draw = ImageDraw.Draw(image)
    size = 34
    while draw.textlength(title, font=font(size)) > 1800 and size > 18:
        size -= 1
    draw.text((960,32), title, font=font(size), fill="#f2f4fa", anchor="mt")
    for index, label in enumerate(LABELS):
        x = 40+index*620
        draw.rounded_rectangle((x-2,122,x+602,1026), radius=10, fill="#343944")
        draw.text((x+300,88), label, font=font(22), fill="#b9a9ff" if index==1 else "#c0c5d1", anchor="mt")
        caption=(panels or {}).get(LANES[index],{}).get("caption", "")
        if caption:
            caption_size=17
            while draw.textlength(caption,font=font(caption_size))>588 and caption_size>10:
                caption_size-=1
            draw.text((x+300,1052),caption,font=font(caption_size),fill="#e7c88a",anchor="mm")
    image.save(path)


def render_shot(shot, output, work):
    background = work / "background.png"
    make_background(background, shot["title"], shot["panels"])
    command = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-filter_complex_threads", "1"]
    for lane in LANES:
        p = shot["panels"][lane]
        command += ["-ss", str(p["start"]), "-i", p["source"]]
    command += ["-loop", "1", "-framerate", str(FPS), "-i", str(background)]
    filters, cursor_index = [], 4
    for index,lane in enumerate(LANES):
        p=shot["panels"][lane]
        filters.append(f"[{index}:v]fps={FPS},trim=end_frame={p['ready_frames']},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop={p['hold_frames']}[source{index}]")
        label=f"source{index}"
        if p.get("cursor"):
            cursor=p["cursor"]
            command += ["-loop", "1", "-framerate", str(FPS), "-i", cursor["image"]]
            keys=[(point[0],point[1:]) for point in cursor["positions"]]
            clock=f"min(t,{(p['ready_frames']-1)/FPS:.8f})"
            x,y=curve(keys,0,clock),curve(keys,1,clock)
            filters.append(f"[{label}][{cursor_index}:v]overlay=x='{x}':y='{y}':eval=frame:shortest=1[cursor{index}]")
            label=f"cursor{index}"
            cursor_index+=1
        # Padding to the panel aspect before zoompan prevents aspect distortion.
        canvas_w=math.ceil(max(p["width"],p["height"]*PANEL_W/PANEL_H)/2)*2
        canvas_h=canvas_w*3//2
        keys=[(k["time"],k["rect"]) for k in p["camera"]]
        clock=f"min(on/{FPS},{(p['ready_frames']-1)/FPS:.8f})"
        x,y,w = [curve(keys,c,clock) for c in (0,1,2)]
        filters.append(f"[{label}]pad={canvas_w}:{math.ceil(canvas_h)}:0:0:color=black,setsar=1,zoompan=z='{canvas_w}/({w})':x='{x}':y='{y}':d=1:s={PANEL_W}x{PANEL_H}:fps={FPS}[panel{index}]")
    base="3:v"
    for index in range(3):
        nxt=f"composite{index}"
        filters.append(f"[{base}][panel{index}]overlay={40+index*620}:124:shortest=1[{nxt}]")
        base=nxt
    command += ["-filter_complex", ";".join(filters), "-map", f"[{base}]", "-frames:v", str(shot["total_frames"]), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output)]
    subprocess.run(command,check=True)
    info=probe(output)
    if int(info.get("nb_frames",-1)) != shot["total_frames"]:
        raise RuntimeError(f"{shot['id']}: export frame count mismatch")


def render(plan, output):
    output=Path(output).resolve()
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="arc-comparison-") as temp:
        work=Path(temp)
        parts=[]
        for index,shot in enumerate(plan["shots"]):
            part=work/f"shot-{index:04d}.mp4"
            render_shot(shot,part,work)
            parts.append(part)
        listing=work/"concat.txt"
        listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts))
        subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","concat","-safe","0","-i",str(listing),"-c","copy","-movflags","+faststart",str(output)],check=True)
    info=probe(output)
    if (info["width"],info["height"],info["r_frame_rate"],int(info.get("nb_frames",-1))) != (1920,1080,"30/1",plan["total_frames"]):
        raise RuntimeError("Final video failed frame count, dimensions or frame rate verification")
    return output


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest",type=Path)
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument("--plan",action="store_true",help="Validate timing/schema and print plan; video assets may be absent")
    mode.add_argument("--check",action="store_true",help="Also require/probe all real source assets")
    parser.add_argument("--output",type=Path,default=Path("demo-video/exports/arc-zen-comparison.mp4"))
    args=parser.parse_args()
    try:
        if not args.plan:
            for tool in ("ffmpeg","ffprobe"):
                if not shutil.which(tool):
                    raise ValueError(f"{tool} is required on PATH")
        plan=load_plan(args.manifest,require_assets=not args.plan)
        if args.plan or args.check:
            print(json.dumps(plan,indent=2))
        else:
            print(render(plan,args.output))
    except (ValueError,KeyError,OSError,RuntimeError,subprocess.CalledProcessError) as exc:
        parser.exit(1,f"Comparison error: {exc}\n")


if __name__ == "__main__":
    main()
