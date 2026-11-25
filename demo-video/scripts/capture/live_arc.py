"""Real-time Arc take of the highlight features, using only the dedicated
"Arc UI Demo" Spaces in the user's Arc window.

    python live_arc.py --window <CG id> --applescript-window <Arc window id> --out DIR [--only id ...]

Requires Accessibility (real mouse/keyboard input) and Screen Recording.
The window must be at 80,80 and 1592x896 points, not full screen. Capture is
ScreenCaptureKit (window-recorder, 60 fps, window only, no system cursor);
the pointer is really moved and the same positions are logged for the
composited cursor. Before every feature the visible Space is checked, and
the Spaces overview is captured with a capture-time crop to the three demo
cards, so other Spaces never reach the disk.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
RECORDER = str(ROOT / 'artifacts/bin/window-recorder')
spec = importlib.util.spec_from_file_location('S', HERE / 'arc-native-session.py')
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)
WX, WY = 80, 80
SCALE = 1920 / 1592
DEMO_SPACES = ('Work · Arc UI Demo', 'Personal · Arc UI Demo', 'Reading · Arc UI Demo')


def now():
    return time.clock_gettime(time.CLOCK_UPTIME_RAW)


def node(predicate):
    return S.find(predicate)


def node_center(n):
    b = n['bounds']
    return b['x'] + b['width'] / 2, b['y'] + b['height'] / 2


def guard():
    names = [n.get('value') for n in S.visible() if n.get('identifier') == 'sidebarSpaceName']
    if names and any(n not in DEMO_SPACES for n in names):
        raise RuntimeError('Refusing capture outside the dedicated demo Spaces')


class Take:
    def __init__(self, out):
        self.out = Path(out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.features = []
        self.pointer = (WX + 800, WY + 520)
        S.native('move', *self.pointer)
        self.clips = []

    def start(self, name, crop=None):
        mov = self.out / f'arc-{name}.mov'
        args = [RECORDER, str(S.WINDOW), str(mov), '60'] + ([str(round(v)) for v in crop] if crop else [])
        self.rec = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        if not json.loads(self.rec.stdout.readline()).get('ready'):
            raise RuntimeError('Recorder did not start')
        self.mov, self.crop = mov, crop
        self.clip_features = []
        time.sleep(.5)

    def stop(self):
        self.rec.stdin.close()
        done = json.loads(self.rec.stdout.read().strip().splitlines()[-1])
        if self.rec.wait() or not done['frames']:
            raise RuntimeError(f'Recorder failed: {done}')
        for f in self.clip_features:
            for key in ('start', 'ready', 'end'):
                f[key] = round(f[key] - done['first'], 4)
            f['events'] = {k: round(v - done['first'], 4) for k, v in f['events'].items()}
            f['source'] = str(self.mov)
            f['crop'] = self.crop
            f['cursor'] = [[round(t, 4), round((x - WX) * SCALE, 1), round((y - WY) * SCALE, 1)] for t, x, y in f['cursor']]
            self.features.append(f)

    def begin(self, fid, availability='native', caption='', check=True):
        if check:  # the cropped Spaces overview is protected by its crop instead
            guard()
        self.cur = {'id': fid, 'start': now(), 'availability': availability, 'caption': caption, 'cursor': [], 'events': {}}
        self.t0 = self.cur['start']
        self.mark()

    def mark(self):
        self.cur['cursor'].append([now() - self.t0, *self.pointer])

    def event(self, name):
        """Named action shared by all lanes; the editor lines lanes up on these."""
        self.cur['events'][name] = now()

    def ready(self, settle):
        time.sleep(settle)
        self.cur['ready'] = now()
        time.sleep(.25)
        self.cur['end'] = now()
        self.clip_features.append(self.cur)

    def glide(self, x, y, seconds=None):
        """Really move the pointer along an eased path (screen points)."""
        d = math.dist(self.pointer, (x, y))
        seconds = seconds or max(.4, min(1.0, .3 + d / 1600))
        self.mark()
        (x0, y0), start = self.pointer, now()
        while True:
            u = min(1, (now() - start) / seconds)
            e = .5 - .5 * math.cos(math.pi * u)
            S.run(S.NATIVE, 'move', x0 + (x - x0) * e, y0 + (y - y0) * e)
            if u >= 1:
                break
            time.sleep(1 / 90)
        self.pointer = (x, y)
        self.mark()

    def click(self, event=None, right=False):
        time.sleep(.1)
        self.mark()
        if event:
            self.event(event)
        if right:
            S.run(S.NATIVE, 'rightclick', *self.pointer)
        else:
            subprocess.run([HUMANCLICK, *map(str, self.pointer)], check=True)


def keystrokes(text, gap=.09):
    """Type at the same pace as the Zen lanes (one script, so no per-key launch delay)."""
    body = '\n'.join(f'keystroke {json.dumps(ch)}\ndelay {gap}' for ch in text)
    S.run('osascript', '-e', 'tell application "System Events"\n' + body + '\nend tell', timeout=20)


HUMANCLICK = str(ROOT / 'artifacts/bin/humanclick')


def row(label):
    """The pinned (topmost) sidebar row with this label."""
    for _ in range(20):
        rows = [n for n in S.visible() if n['role'] == 'AXButton' and S.label(n) == label]
        if rows:
            return min(rows, key=lambda n: n['bounds']['y'])
        time.sleep(.15)
    raise RuntimeError('No sidebar row ' + label)


def current_page():
    return next((S.label(n) for n in S.visible() if n.get('role') == 'AXWebArea'), '')


def select_row(label):
    """Select a sidebar tab. Clicking a tab that is already selected makes Arc
    start renaming it (and keeps a hidden sidebar pinned open), so never do that."""
    prefix = label.split(' - ')[0].split(':')[0]
    if not current_page().startswith(prefix):
        x, y = node_center(row(label))
        subprocess.run([HUMANCLICK, str(x), str(y)], check=True)
        time.sleep(.8)
    S.native('key', 53)  # dismiss any rename field
    time.sleep(.2)


def disclose(expanded):
    n = node(lambda n: n.get('value') == 'Web development')
    S.run(S.AX, 'disclose', S.WINDOW, '.'.join(n['path'].split('.')[:-2]), 'Web development', str(expanded).lower())


def reset_work():
    close_extra_tabs()
    S.focus('Work')
    time.sleep(.5)
    disclose(True)
    time.sleep(.4)
    select_row('CSS: Cascading Style Sheets')


def f_folders(t):
    # Arc keeps the selected tab visible inside a collapsed folder, so select
    # the tab outside the folder first; then the folder really closes.
    select_row('Web APIs - MDN')
    t.begin('work-space-essentials-and-real-documentation')
    time.sleep(.35)
    t.glide(*node_center(node(lambda n: n['role'] == 'AXStaticText' and n.get('value') == 'Web development')))
    time.sleep(.1)
    t.mark()
    t.event('collapse')
    disclose(False)
    time.sleep(.9)
    t.mark()
    t.event('expand')
    disclose(True)
    t.ready(.9)
    select_row('CSS: Cascading Style Sheets')


def f_space(t):
    t.begin('personal-space')
    time.sleep(.3)
    t.glide(*node_center(node(lambda n: n['role'] == 'AXButton' and S.label(n) == 'Personal · Arc UI Demo')))
    t.click('switch')
    t.ready(1.4)
    reset_work()


def f_peek(t):
    t.begin('hover-peek')
    time.sleep(.3)
    t.glide(*node_center(node(lambda n: S.label(n) == 'Hide sidebar')))
    t.click('hide')
    time.sleep(.8)
    t.glide(WX + 800, WY + 420, .5)
    time.sleep(.2)
    t.glide(WX + 1, WY + 420, .7)
    t.event('peek')
    time.sleep(1.3)
    t.event('unpeek')
    t.glide(WX + 800, WY + 420, .6)
    t.ready(.9)
    S.menu('View', 'Show Sidebar')
    time.sleep(1.0)


def f_command(t):
    t.begin('centered-command-bar')
    time.sleep(.4)
    t.event('open')
    S.menu('File', 'Open Command Bar')
    time.sleep(.35)
    keystrokes('split')
    t.event('typed')
    t.ready(.9)
    S.native('key', 53)
    time.sleep(.6)


def f_split(t):
    # The tab's own context menu splits instantly; no command bar.
    t.begin('side-by-side-split-view')
    time.sleep(.3)
    x, y = node_center(row('Web APIs - MDN'))
    t.glide(x, y)
    t.click(right=True)
    time.sleep(.35)
    t.glide(x + 70, y + 206, .3)  # "Open in Split View"
    t.click('split')
    t.ready(2.0)
    S.menu('View', 'Separate Page from Split View')
    time.sleep(1.5)
    reset_work()


def open_library_spaces():
    S.press(node(lambda n: n['role'] == 'AXButton' and n.get('description') == 'Home'))
    time.sleep(.6)
    S.press(node(lambda n: n.get('role') == 'AXButton' and n.get('description') == 'Spaces'))
    time.sleep(1.2)


def close_library():
    back = S.find(lambda n: n['role'] == 'AXButton' and n.get('description') == '' and n.get('bounds', {}).get('x', 999) < 120 and n['bounds']['y'] > 900)
    S.press(back)
    time.sleep(1.0)


def spaces_crop_points():
    """Window-relative rectangle around only the three demo Space cards, padded
    to the panel's 2:3 shape where that stays clear of other Spaces."""
    spec = importlib.util.spec_from_file_location('C', HERE / 'capture-arc-comparison.py')
    C = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(C)
    C.S.WINDOW, C.S.AS_WINDOW = S.WINDOW, S.AS_WINDOW
    open_library_spaces()
    crop = None
    for _ in range(20):
        crop = C.spaces_crop()
        if crop:
            break
        time.sleep(.2)
    close_library()
    if crop is None:
        raise RuntimeError('Could not isolate the demo Space cards')
    x, y, w, h = crop
    return (x - WX, y - WY, w, h)


def f_library(t):
    """Window take up to the Home click; the overview itself is recorded separately,
    cropped to the demo cards, so the library's other views never reach the disk."""
    t.begin('library-spaces')
    time.sleep(.3)
    t.glide(*node_center(node(lambda n: n['role'] == 'AXButton' and n.get('description') == 'Home')))
    time.sleep(.1)
    t.mark()
    t.event('library')
    t.cur['ready'] = t.cur['end'] = now()
    t.clip_features.append(t.cur)


def f_library_cards(t):
    t.begin('library-spaces-cards', check=False)
    t.event('spaces')
    t.ready(1.4)


def f_flight(t, page):
    subprocess.run(['osascript', '-e', f'tell application "Arc" to tell window id "{S.AS_WINDOW}" to make new tab with properties {{URL:"{page}"}}'], check=True)
    time.sleep(2.0)
    t.begin('download-file-flight')
    time.sleep(.3)
    t.glide(WX + 1000, WY + 300)
    t.click('download')
    t.ready(2.6)


def f_live(t):
    # GitHub Live Folders in Arc need a signed-in GitHub account; the demo
    # profile is signed out, so show the real entry point instead.
    reset_work()
    t.begin('github-live-folders', 'alternative', 'Needs GitHub sign-in')
    time.sleep(.3)
    t.glide(*node_center(node(lambda n: n['role'] == 'AXButton' and S.label(n).startswith('GitHub'))))
    t.click('create')
    t.ready(1.5)
    reset_work()


def close_extra_tabs():
    """Close unpinned tabs that earlier takes left in the Work demo Space."""
    for attempt in range(3):
        try:
            return _close_extra_tabs()
        except subprocess.CalledProcessError:
            time.sleep(1)
    raise RuntimeError('Could not close leftover demo tabs')


def _close_extra_tabs():
    S.run('osascript', '-e', '''tell application "Arc"
  repeat 10 times
    set closed to false
    repeat with t in tabs of space "Work · Arc UI Demo" of front window
      if (location of t as text) is "unpinned" then
        close t
        set closed to true
        exit repeat
      end if
    end repeat
    if not closed then exit repeat
  end repeat
end tell''', timeout=20)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--window', type=int, required=True)
    parser.add_argument('--applescript-window', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--page', required=True, help='download fixture file URL')
    parser.add_argument('--only', nargs='*')
    args = parser.parse_args()
    S.WINDOW, S.AS_WINDOW = args.window, args.applescript_window
    want = lambda f: not args.only or f in args.only
    subprocess.run(['open', '-a', 'Arc'], check=True)
    time.sleep(1.5)
    S.wake()
    close_extra_tabs()
    reset_work()
    t = Take(args.out)
    crop = spaces_crop_points() if want('library') else None
    reset_work()
    t.start('main')
    try:
        for name, fn in [('folders', f_folders), ('space', f_space), ('peek', f_peek), ('command', f_command),
                         ('split', f_split)]:
            if want(name):
                fn(t)
        if want('library'):
            f_library(t)
    finally:
        t.stop()
    if want('library'):
        S.press(node(lambda n: n['role'] == 'AXButton' and n.get('description') == 'Home'))
        time.sleep(.6)
        S.press(node(lambda n: n.get('role') == 'AXButton' and n.get('description') == 'Spaces'))
        time.sleep(1.6)  # let the overview settle before the cropped capture starts
        t.start('spaces', crop)
        try:
            f_library_cards(t)
        finally:
            t.stop()
        close_library()
        reset_work()
    t.start('tail')
    try:
        if want('flight'):
            f_flight(t, args.page)
        if want('live'):
            f_live(t)
    finally:
        t.stop()
    close_extra_tabs()
    (args.out / 'arc.json').write_text(json.dumps({'lane': 'arc', 'features': t.features}, indent=1))
    print(json.dumps([(f['id'], round(f['ready'] - f['start'], 2)) for f in t.features]))


if __name__ == '__main__':
    main()
