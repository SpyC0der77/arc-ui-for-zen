"""Turn the real-time takes (recordings/live) into a polished.py manifest.

    python demo-video/scripts/live_manifest.py

Each window movie is converted to constant 60 fps, 1920x1080 H.264 (a cropped
take is scaled by the same factor and padded to the panel's 2:3 shape). Feature
timings and cursor tracks come from the take logs. Per-lane cameras default
to the original comparison cameras for that feature.
"""
import json
import math
from pathlib import Path
import subprocess

DEMO = Path(__file__).resolve().parents[1]
LIVE = DEMO / 'recordings/live'
CFR = LIVE / 'cfr'
SCALE = 1920 / 1592
CURSOR = DEMO / 'assets/cursor.png'
ARC_BG = '0xE9E1EE'


def probe(path):
    out = subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                                   'stream=width,height', '-of', 'json', str(path)], text=True)
    s = json.loads(out)['streams'][0]
    return s['width'], s['height']


def convert(mov, padded=False):
    CFR.mkdir(parents=True, exist_ok=True)
    out = CFR / (mov.stem + '-60.mp4')
    if out.exists() and out.stat().st_mtime > mov.stat().st_mtime:
        return out
    w, h = probe(mov)
    sw, sh = round(w * SCALE / 2) * 2, round(h * SCALE / 2) * 2
    # Capture only delivers frames on change; hold the last one past the take.
    vf = f'fps=60,scale={sw}:{sh}:flags=lanczos,tpad=stop_mode=clone:stop_duration=4'
    if padded:
        ph = max(sh, math.ceil(sw * 1.5 / 2) * 2)
        vf += f',pad={sw}:{ph}:0:0:color={ARC_BG}'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(mov), '-vf', vf, '-c:v', 'libx264', '-preset', 'medium',
                    '-crf', '14', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709',
                    '-colorspace', 'bt709', '-movflags', '+faststart', str(out)], check=True)
    return out


def duration(path):
    return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                         '-of', 'csv=p=0', str(path)], text=True))


def edge_color(path, start):
    """Average colour of a frame's border, to extend a cropped clip seamlessly."""
    from PIL import Image
    import io
    png = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(start + .3), '-i', str(path), '-frames:v', '1',
                          '-f', 'image2pipe', '-vcodec', 'png', '-'], capture_output=True, check=True).stdout
    im = Image.open(io.BytesIO(png)).convert('RGB')
    w, h = im.size
    px = [im.getpixel((x, y)) for x in range(0, w, 8) for y in (2, h - 3)] + \
         [im.getpixel((x, y)) for y in range(0, h, 8) for x in (2, w - 3)]
    return '0x%02X%02X%02X' % tuple(sum(c[i] for c in px) // len(px) for i in range(3))


XFADE = .35


def arc_library(main_f, cards_f):
    """One Arc source for the Spaces overview: the window take up to the Home
    click, then a crossfade to the three demo cards, whole and centred in the
    panel's area (the recording was cropped to them so other Spaces never
    reach the disk)."""
    out = CFR / 'arc-library-60.mp4'
    head = main_f['events']['library'] - main_f['start'] + .05 + XFADE
    _, _, w, h = cards_f['crop']
    scale = min(720 / w, 1080 / h) * .94
    cw, ch = round(w * scale / 2) * 2, round(h * scale / 2) * 2
    cx, cy = (720 - cw) // 2, (1080 - ch) // 2
    bg = edge_color(cards_f['source'], cards_f['start'])
    graph = (f"[0:v]fps=60,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[a];"
             f"[1:v]fps=60,scale={cw}:{ch}:flags=lanczos,pad=1920:1080:{cx}:{cy}:color={bg},setsar=1,"
             f"tpad=stop_mode=clone:stop_duration=4,format=yuv420p[b];"
             f"[a][b]xfade=transition=fade:duration={XFADE}:offset={head - XFADE:.4f}[v]")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(main_f['start']), '-t', f'{head:.4f}', '-i', main_f['source'],
                    '-ss', str(cards_f['start']), '-i', cards_f['source'], '-filter_complex', graph, '-map', '[v]',
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', str(out)], check=True)
    joined = head - XFADE  # cards clip time 0 lands here
    f = dict(main_f)
    f.update(source=str(out), start=0.0, crop=None,
             events={'library': main_f['events']['library'] - main_f['start'],
                     'spaces': joined + cards_f['events']['spaces'] - cards_f['start']},
             ready=joined + cards_f['ready'] - cards_f['start'] + XFADE,
             end=joined + cards_f['end'] - cards_f['start'] + XFADE, cursor=main_f['cursor'])
    return f


# Where each shared action shows up (1920x1080 pixels), and how long before the
# logged event its reaction may begin (peek reveals while the pointer travels).
REGIONS = {'collapse': (0, 0, 400, 1080), 'expand': (0, 0, 400, 1080), 'switch': (0, 0, 400, 1080),
           'hide': (0, 0, 500, 1080), 'peek': (0, 0, 500, 1080), 'unpeek': (0, 0, 500, 1080),
           'open': (400, 0, 1520, 1080), 'typed': (400, 0, 1520, 1080), 'split': (400, 0, 1520, 1080),
           'create': (0, 0, 400, 1080), 'download': (950, 120, 520, 520)}
LEAD_IN = {'peek': .75, 'unpeek': 0}


def response(source, t, region=None, window=1.8, threshold=.35):
    """Seconds after source time t until the region visibly changes (the UI's
    real reaction to an action), or 0 if nothing changes."""
    import numpy as np
    w, h = 240, 270
    crop = 'crop={2}:{3}:{0}:{1},'.format(*region) if region else ''
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{max(t, 0):.4f}', '-t', str(window), '-i', str(source),
                          '-vf', f'fps=60,{crop}scale={w}:{h}', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
                         capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.int16)
    first = next((i for i in range(1, len(frames)) if np.abs(frames[i] - frames[0]).mean() > threshold), None)
    if first is None:
        return 0.0
    # Align on when the change finishes: browsers animate the same action over
    # different lengths of time, and the settled state is what viewers compare.
    step = [np.abs(frames[i] - frames[i - 1]).mean() for i in range(1, len(frames))]
    last, quiet = first, 0
    for i in range(first, len(step)):
        if step[i] > .12:
            last, quiet = i + 1, 0
        else:
            quiet += 1
            if quiet >= 15:
                break
    return last / 60


def visible_events(f, source):
    """Event times moved to when each lane's UI actually responds."""
    out = {}
    for k, v in f.get('events', {}).items():
        lead = LEAD_IN.get(k, 0)
        f.setdefault('anchors', {})[k] = v - lead  # freeze before the action, never after it
        out[k] = v - lead + response(source, v - lead, REGIONS.get(k))
    return out


def add_moves(f):
    """Cursor glides as sync points: 'move0', 'move1', ... at each glide's start.
    Matching glides then start together in every lane; the hold sits just
    before the glide, while the pointer is still."""
    c = f['cursor']
    starts = [c[i - 1][0] for i in range(1, len(c)) if c[i][1:] != c[i - 1][1:]]
    for k, t in enumerate(starts):
        name = f'move{k}'
        f['events'][name] = f['start'] + t
        f.setdefault('anchors', {})[name] = f['start'] + t


def holds_for(features):
    """Freeze each lane just before shared actions so they happen together."""
    lanes = list(features)
    rel = {l: {k: v - features[l]['start'] for k, v in features[l].get('events', {}).items()} for l in lanes}
    shared = [k for k in sorted(rel['themed'], key=rel['themed'].get) if all(k in rel[l] for l in lanes)]
    # An event's freeze point (anchor) must also come after the previous one;
    # e.g. 'peek' is anchored before the edge glide that causes it, so the glide wins.
    anc = {l: {k: features[l].get('anchors', {}).get(k, features[l]['events'][k]) - features[l]['start']
               for k in rel[l]} for l in lanes}
    ordered, last = [], {l: -1.0 for l in lanes}
    for k in shared:
        if all(rel[l][k] >= last[l] and anc[l][k] >= last[l] for l in lanes):
            ordered.append(k)
            for l in lanes:
                last[l] = max(rel[l][k], anc[l][k])
    shared = ordered
    offset = {l: 0.0 for l in lanes}
    holds = {l: [] for l in lanes}
    for k in shared:
        target = max(rel[l][k] + offset[l] for l in lanes)
        for l in lanes:
            gap = target - (rel[l][k] + offset[l])
            if gap > 1 / 60:
                anchor = features[l].get('anchors', {}).get(k, features[l]['events'][k]) - features[l]['start']
                holds[l].append([round(max(anchor - .04, 0), 4), round(gap, 4)])
                offset[l] += gap
    for l in lanes:
        holds[l].sort()
    return holds, shared


SPLIT_CAMERA = [{'time': 0, 'rect': [740, 0, 720, 1080]}]


def main():
    old = {s['id']: s for s in json.loads((DEMO / 'timeline/comparison.json').read_text())['shots']}
    lanes = {}
    for lane, name in (('themed', 'themed'), ('zen', 'vanilla'), ('arc', 'arc')):
        data = json.loads((LIVE / f'{name}.json').read_text())
        lanes[lane] = {f['id']: f for f in data['features']}
        for f in lanes[lane].values():
            f.setdefault('source', data.get('source'))
    CFR.mkdir(parents=True, exist_ok=True)
    if 'library-spaces-cards' in lanes['arc']:
        cards = lanes['arc'].pop('library-spaces-cards')
        main_f = dict(lanes['arc']['library-spaces'])
        main_f['source'] = str(convert(Path(main_f['source'])))
        lanes['arc']['library-spaces'] = arc_library(main_f, cards)
    ids = list(lanes['themed'])
    tracks = LIVE / 'cursor'
    tracks.mkdir(exist_ok=True)
    shots = []
    for fid in ids:
        feats = {lane: dict(lanes[lane][fid]) for lane in ('arc', 'themed', 'zen')}
        for lane, f in feats.items():
            mov = Path(f['source'])
            f['source'] = str(mov if mov.parent == CFR else convert(mov))
            if f.get('availability') != 'unavailable':
                f['events'] = visible_events(f, f['source'])
            add_moves(f)
        holds, shared = holds_for(feats)
        panels = {}
        for lane, f in feats.items():
            mov = Path(f['source'])
            source = mov if mov.parent == CFR else convert(mov)
            ready = max(f['ready'] - f['start'], 1 / 60)
            end = max(f['end'], f['ready']) - f['start'] + 1 / 30
            camera = old[fid]['panels'][lane]['camera'] if fid in old else [{'time': 0, 'rect': [0, 0, 720, 1080]}]
            camera = [k for k in camera if k['time'] <= ready] or camera[:1]
            if fid == 'side-by-side-split-view':
                camera = SPLIT_CAMERA
            if lane == 'arc' and fid == 'library-spaces':
                camera = [{'time': 0, 'rect': [0, 0, 720, 1080]}]  # sidebar, then the centred cards
            positions = [[0, *f['cursor'][0][1:]]] + [p for p in f['cursor'][1:] if p[0] > 0]
            track = tracks / f'{lane}-{fid}.json'
            track.write_text(json.dumps({'image': str(CURSOR), 'positions': positions, 'recorded': True}))
            end = min(end, duration(source) - max(f['start'], 0) - 1 / 60)
            panel = {'source': str(source), 'start': round(max(f['start'], 0), 4),
                     'end': round(max(f['start'], 0) + end, 4), 'ready': round(ready, 4), 'camera': camera,
                     'availability': f.get('availability', 'native'), 'cursor_track': str(track)}
            if holds[lane]:
                panel['holds'] = holds[lane]
            if fid == 'side-by-side-split-view':
                panel['zoom_out'] = 1.5
            if f.get('caption'):
                panel['caption'] = f['caption']
            panels[lane] = panel
        shots.append({'id': fid, 'title': old.get(fid, {}).get('title', fid), 'synced_on': shared, 'panels': panels})
    out = DEMO / 'timeline/live.json'
    out.write_text(json.dumps({'capture': 'Real-time 60 fps window recordings (ScreenCaptureKit)', 'shots': shots}, indent=1))
    print(out)


if __name__ == '__main__':
    main()
