"""Compose the original real installer take and retain its exact actions/timings."""
import argparse
import ast
import json
from pathlib import Path
import subprocess

DEMO=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--take',type=Path,required=True)
    parser.add_argument('--output-root',type=Path,required=True)
    args=parser.parse_args()
    evidence=json.loads(args.take.read_text())
    if evidence.get('completed') is not True or evidence.get('frames')!=570:
        parser.error('A complete, successful original19-second installer capture is required')
    source=Path(evidence['shots'][0]['source'])
    root=args.output_root.resolve(); recordings=root/'recordings';timeline=root/'timeline'
    recordings.mkdir(parents=True,exist_ok=True);timeline.mkdir(parents=True,exist_ok=True)
    output=recordings/'onboarding.mp4'
    if output.exists():parser.error(f'Refusing to overwrite {output}')
    # Same wallpaper composition, app scaling and position as scripts/build.py.
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error',
        '-loop','1','-i',str(DEMO/'assets/wallpaper.jpg'),'-i',str(source),
        '-filter_complex','[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[bg];[1:v]scale=1296:888[app];[bg][app]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1[v]',
        '-map','[v]','-t','19','-r','30','-an','-c:v','libx264','-preset','fast',
        '-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],check=True)
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0',
        '-show_entries','stream=width,height,r_frame_rate,nb_frames','-of','json',str(output)],text=True))['streams'][0]
    if (info['width'],info['height'],info['r_frame_rate'],int(info['nb_frames']))!=(1920,1080,'30/1',570):
        raise RuntimeError('Installer composition failed format/frame-count verification')
    # Reuse the original cursor author's installer coordinates and timings.
    tree=ast.parse((DEMO/'scripts/add-cursor.py').read_text())
    cues=next(ast.literal_eval(node.iter) for node in tree.body if isinstance(node,ast.For)
              and isinstance(node.target,ast.Tuple) and [n.id for n in node.target.elts]==['t','xy'])
    keys=[[0,1170,800]]
    for t,point in cues:
        previous=keys[-1][1:]
        keys.extend([[t-.65,*previous],[t-.08,*point],[t+.32,*point]])
    cursor=timeline/'onboarding-cursor.json'
    cursor.write_text(json.dumps({'image':str(DEMO/'assets/cursor.png'),'positions':keys},indent=2)+'\n')
    metadata={'complete':True,'source_script':evidence['source_script'],'source_sha256':evidence['source_sha256'],
        'installation':evidence['installation'],'profile':evidence['profile'],
        'shots':[{'name':'Onboarding','file':'recordings/onboarding.mp4','start':0,'end':19,'ready':19,
          'cursor_track':str(cursor),'caption':'Arc UI setup',
          'camera':[{'time':0,'rect':[600,0,720,1080]},{'time':2.5,'rect':[600,0,720,1080]},
                    {'time':3.8,'rect':[276,0,720,1080]}],
          'notes':'Full original installer take, with a genuine successful disposable installation. Other native lanes wait at their baseline before the common pause.'}]}
    (timeline/'onboarding-checkpoints.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(output)


if __name__=='__main__':main()
