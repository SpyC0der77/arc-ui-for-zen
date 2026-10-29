"""Rebuild the demo from saved real-UI recordings. Does not launch a browser."""
import argparse
import json
from pathlib import Path
import shutil
import subprocess
import sys

DEMO = Path(__file__).resolve().parents[1]


def run(*args):
    subprocess.run([str(a) for a in args], cwd=DEMO, check=True)


def inspect(video):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_entries',
        'format=duration:stream=width,height,r_frame_rate,nb_frames',
        '-of', 'json', str(video)
    ], text=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate assets and source ranges without rendering')
    parser.add_argument('--rebuild-onboarding', action='store_true', help='Recompose the installer take over the bundled wallpaper')
    args = parser.parse_args()
    for tool in ['ffmpeg', 'ffprobe']:
        if not shutil.which(tool):
            raise SystemExit(f'{tool} is required on PATH')
    edit = json.loads((DEMO / 'timeline/edit.json').read_text())
    for asset in ['assets/cursor.png', 'assets/wallpaper.jpg', 'timeline/edit.ffconcat']:
        if not (DEMO / asset).is_file():
            raise SystemExit(f'Missing {asset}')
    duration = 0
    probes = {}
    for filename, start, end in edit['segments']:
        source = DEMO / 'recordings' / filename
        if not source.is_file():
            raise SystemExit(f'Missing recording: {source}')
        if filename not in probes:
            probes[filename] = inspect(source)
        if not 0 <= start < end <= float(probes[filename]['format']['duration']) + .04:
            raise SystemExit(f'Invalid source range: {filename} {start}..{end}')
        duration += end - start
    if abs(duration - edit['duration']) > .001:
        raise SystemExit('Edit duration does not match its segments')
    print(f'Validated {len(edit["segments"])} segments, {duration:g} seconds.', flush=True)
    if args.check:
        return
    exports = DEMO / 'exports'
    exports.mkdir(exist_ok=True)
    if args.rebuild_onboarding:
        run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
            '-loop', '1', '-i', 'assets/wallpaper.jpg', '-i', 'recordings/onboarding-window.mp4',
            '-filter_complex', '[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080[bg];[1:v]scale=1296:888[app];[bg][app]overlay=(W-w)/2:(H-h)/2:shortest=1,setsar=1[v]',
            '-map', '[v]', '-t', '19', '-r', '30', '-c:v', 'libx264', '-preset', 'fast',
            '-crf', '17', '-pix_fmt', 'yuv420p', 'recordings/onboarding.mp4')
    base = exports / 'arc-ui-for-zen-demo.mp4'
    output = exports / 'arc-ui-for-zen-demo-cursor.mp4'
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-copyts',
        '-segment_time_metadata', '1', '-safe', '0', '-i', 'timeline/edit.ffconcat',
        '-vf', 'select=concatdec_select,setpts=N/30/TB', '-an', '-c:v', 'libx264',
        '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', base)
    run(sys.executable, DEMO / 'scripts/add-cursor.py')
    run('ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', base,
        '-loop', '1', '-i', 'assets/cursor.png', '-filter_complex',
        '[0:v]sendcmd=f=timeline/cursor-commands.txt[screen];[screen][1:v]overlay@cursor=x=1170:y=800:eval=frame:format=auto:shortest=1,format=yuv420p[v]',
        '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17',
        '-movflags', '+faststart', output)
    result = inspect(output)
    stream = result['streams'][0]
    if (stream['width'], stream['height'], stream['r_frame_rate']) != (1920, 1080, '30/1'):
        raise SystemExit('Unexpected export resolution or frame rate')
    if abs(float(result['format']['duration']) - duration) > .04:
        raise SystemExit('Unexpected export duration')
    print(output)


if __name__ == '__main__':
    main()
