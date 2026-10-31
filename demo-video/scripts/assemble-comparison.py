"""Assemble the original retained edit from three sets of actual capture metadata.

python assemble-comparison.py --themed SESSION_ROOT --arc arc-shots.json
    --zen vanilla-shots.json --output comparison.json

Requires every original retained shot, including the real theme installer.
During theme installation the other browsers hold their own real baseline views.
Missing captures are errors;
this tool never substitutes another browser, a still image, or fabricated footage.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re

DEMO=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location("comparison",Path(__file__).with_name("comparison.py"))
COMPARISON=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPARISON)
TAKES={"browser":"shots.json","controls":"controls-shots.json","details":"details-shots.json","archive-real":"archive-real-shots.json"}


def slug(name):
    return re.sub(r"[^a-z0-9]+","-",name.lower()).strip("-")


def read(path):
    return json.loads(Path(path).read_text())


def index_shots(data,context):
    if data.get('complete') is False or data.get('completed') is False:
        raise ValueError(f'{context}: recording is incomplete; partial takes cannot be assembled')
    result={}
    for shot in data.get("shots",[]):
        key=shot.get("name") or shot.get("id")
        if not key or key in result:
            raise ValueError(f"{context}: missing or duplicate shot name: {key}")
        result[key]=shot
    return result


def lookup(index,name,context):
    if name in index:
        return index[name]
    matches=[s for key,s in index.items() if slug(key)==slug(name) or s.get("id")==slug(name)]
    if len(matches)!=1:
        raise ValueError(f"{context}: missing or ambiguous shot: {name}")
    return matches[0]


def source_path(shot,base):
    source=shot.get("source") or shot.get("file")
    if not source:
        raise ValueError(f"{shot.get('name')}: metadata has no source file")
    path=(base/source).resolve()
    if not path.is_file():
        raise ValueError(f"Missing real-video source: {path}")
    return path


def camera_for(name,width,height,ready,authored=None):
    lower=name.lower()
    if authored:
        if isinstance(authored[0],dict):
            return authored
        x,y,w,h=authored
    else:
        h=min(height,width*1.5);w=h*2/3;y=0
        centered=any(word in lower for word in ('command','split','one page'))
        x=(width-w)/2 if centered else 0
    if 'command' in lower:
        # Keep the query and command labels, rather than centering a tight crop
        # on the middle of the wide command card and clipping its left edge.
        x=max(0,min(width-w,width*.25))
    initial=[x,y,w,h]
    if not authored and lower in ('download file flight','hidden sidebar download'):
        # The original preview API launches from x=1000/1100 in a 1592px window.
        # Follow that real source region toward the lower-left destination.
        launch_x=width*(1100 if lower=='hidden sidebar download' else 1000)/1592
        initial=[max(0,min(width-w,launch_x-w*.4)),0,w,h]
        return [{"time":0,"rect":initial},{"time":min(.8,ready),"rect":[x,y,w,h]}]
    # Keep the feature framing steady across the shared pause and next shot.
    # Explicitly authored keyframes above still support intentional pans.
    return [{"time":0,"rect":initial}]


def panel(shot,base,name,info_cache,camera_override=None):
    source=source_path(shot,base)
    if source not in info_cache:
        info_cache[source]=COMPARISON.probe(source)
    info=info_cache[source]
    if "ready" not in shot:
        raise ValueError(f"{name}: missing measured ready checkpoint")
    ready=COMPARISON.number(shot["ready"],f"{name}.ready")
    authored=shot.get('camera')
    matching_override=camera_override if camera_override and source.as_posix().endswith(camera_override['source_suffix']) else {}
    authored=matching_override.get('keyframes',authored)
    p={"source":str(source),"start":shot["start"],"end":shot["end"],"ready":ready,
       "camera":camera_for(name,info["width"],info["height"],ready,authored)}
    availability=shot.get("availability","native")
    if availability not in ("native","unavailable","alternative"):
        raise ValueError(f"{name}: unknown availability: {availability}")
    caption=shot.get("caption")
    if not caption and availability=="unavailable":
        caption="No native equivalent"
    elif not caption and availability=="alternative":
        caption="Native alternative"
    if caption:p["caption"]=caption
    if shot.get("notes"):p["notes"]=shot["notes"]
    p["availability"]=availability
    if shot.get("cursor_track"):
        p["cursor_track"]=str((base/shot["cursor_track"]).resolve())
    if matching_override.get('cursor_offset'):
        p['cursor_offset']=matching_override['cursor_offset']
    return p


def assemble(themed,arc,zen,timeline=DEMO/"timeline",camera_overrides=None):
    themed,arc,zen,timeline=map(lambda p:Path(p).resolve(),(themed,arc,zen,timeline))
    native={"arc":index_shots(read(arc),"Arc"),"zen":index_shots(read(zen),"Zen")}
    if camera_overrides is None:
        camera_file=DEMO/'timeline/comparison-cameras.json'
        camera_overrides=read(camera_file) if camera_file.is_file() else {}
    checkpoints={}
    for take in TAKES:
        path=themed/"timeline"/f"{take}-checkpoints.json"
        if not path.is_file():
            raise ValueError(f"Missing themed checkpoint metadata: {path}")
        checkpoints[take]=index_shots(read(path),f"themed/{take}")
    original={take:read(timeline/filename) for take,filename in TAKES.items()}
    shots=[]
    info_cache={}
    for filename,start,end in read(timeline/"edit.json")["segments"]:
        take=Path(filename).stem
        if take=="onboarding":
            continue
        if take not in original:
            raise ValueError(f"Unsupported original take: {filename}")
        retained=[s for s in original[take] if start<=s["start"]<end]
        if not retained:
            raise ValueError(f"Original segment contains no shots: {filename} {start}..{end}")
        for original_shot in retained:
            name=original_shot["name"]
            if original_shot["start"]+original_shot["duration"]>end+1e-8:
                raise ValueError(f"Original edit cuts inside a shot: {name}")
            sources={"themed":lookup(checkpoints[take],name,f"themed/{take}"),
                     "arc":lookup(native["arc"],name,"Arc"),"zen":lookup(native["zen"],name,"Zen")}
            shots.append({"id":slug(name),"title":name,"panels":{
                lane:panel(s,themed if lane=="themed" else (arc.parent if lane=="arc" else zen.parent),name,info_cache,
                           camera_overrides.get(slug(name),{}).get(lane))
                for lane,s in sources.items()}})
    ids=[s["id"] for s in shots]
    if len(ids)!=len(set(ids)):
        raise ValueError("Retained edit contains duplicate feature ids")
    return {"capture":"Three actual browser recordings; original themed recorder actions preserved",
            "shots":shots}


def main():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--themed",type=Path,required=True,help="Output root from record-themed.py")
    parser.add_argument("--arc",type=Path,required=True)
    parser.add_argument("--zen",type=Path,required=True)
    parser.add_argument("--timeline",type=Path,default=DEMO/"timeline")
    parser.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    try:
        data=assemble(args.themed,args.arc,args.zen,args.timeline)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        # Validate full asset/range/camera constraints before publishing manifest.
        import tempfile
        with tempfile.TemporaryDirectory(prefix="arc-comparison-manifest-") as temp:
            validation=Path(temp)/"manifest.json"
            validation.write_text(json.dumps(data))
            plan=COMPARISON.load_plan(validation,True)
        args.output.write_text(json.dumps(data,indent=2)+"\n")
        print(f"{args.output.resolve()} ({len(data['shots'])} shots, {plan['duration']:.3f}s)")
    except (ValueError,KeyError,OSError) as exc:
        parser.exit(1,f"Assembly error: {exc}\n")


if __name__=="__main__":main()
