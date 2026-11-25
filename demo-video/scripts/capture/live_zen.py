"""Real-time take of the highlight features for one disposable Zen lane.

Run inside marionette-host.py (it provides `m` and `info`). Set LANE ('themed'
or 'vanilla'), OUT (folder) and optionally ONLY (feature ids) first:

    LANE='themed'; OUT='/path/out'; exec(open('live_zen.py').read()); result=record()

The window is captured by window-recorder (ScreenCaptureKit, 60 fps, window
only, no system cursor). Every action is real browser code; the cursor is
composited later from the logged positions. Writes <lane>.mov and <lane>.json
(per feature: start, ready and end in seconds of the movie, plus the cursor
track in 1920x1080 pixels).
"""
import json
import subprocess
import time
from pathlib import Path

ROOTDIR = Path(__file__).resolve().parents[3] if '__file__' in globals() else Path.cwd()
RECORDER = str(ROOTDIR / 'artifacts/bin/window-recorder')
SCALE = 1920 / 1592  # window points -> 1920x1080 video pixels


def now():
    return time.clock_gettime(time.CLOCK_UPTIME_RAW)


def js(code, *args):
    return m.execute_script(code, script_args=list(args))


def center(expr):
    """Center of a chrome element, in window points."""
    r = js('const e=(' + expr + ');if(!e)return null;const b=e.getBoundingClientRect();return [b.x+b.width/2,b.y+b.height/2]')
    if r is None:
        raise RuntimeError('No element for ' + expr)
    return r


class Take:
    def __init__(self, out):
        self.out = Path(out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.features = []
        self.cursor = (800, 520)

    # -- capture
    def start(self):
        subprocess.run(['osascript', '-e', f'tell application "System Events" to set frontmost of (first process whose unix id is {info["pid"]}) to true'], check=True)
        time.sleep(.8)
        wins = json.loads(subprocess.check_output([RECORDER, 'list', str(info['pid'])]))
        win = max(wins, key=lambda w: w['bounds']['Width'] * w['bounds']['Height'])
        if (win['bounds']['Width'], win['bounds']['Height']) != (1592, 896):
            raise RuntimeError(f'Unexpected window size {win}')
        self.mov = self.out / f'{LANE}.mov'
        self.rec = subprocess.Popen([RECORDER, str(win['id']), str(self.mov), '60'], stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, text=True)
        ready = json.loads(self.rec.stdout.readline())
        if not ready.get('ready'):
            raise RuntimeError('Recorder did not start')
        # Nudge a repaint so the first frame arrives immediately.
        js('document.documentElement.style.outline="0px solid transparent"')
        time.sleep(.6)

    def stop(self):
        self.rec.stdin.close()
        done = json.loads(self.rec.stdout.read().strip().splitlines()[-1])
        if self.rec.wait() or not done['frames']:
            raise RuntimeError(f'Recorder failed: {done}')
        first = done['first']
        for f in self.features:
            for key in ('start', 'ready', 'end'):
                f[key] = round(f[key] - first, 4)
            f['events'] = {k: round(v - first, 4) for k, v in f['events'].items()}
            f['cursor'] = [[round(t, 4), round(x * SCALE, 1), round(y * SCALE, 1)] for t, x, y in f['cursor']]
        meta = {'lane': LANE, 'source': str(self.mov), 'first_host': first, 'frames': done['frames'],
                'features': self.features}
        (self.out / f'{LANE}.json').write_text(json.dumps(meta, indent=1))
        return meta

    # -- feature bookkeeping
    def begin(self, fid, availability='native', caption=''):
        self.cur = {'id': fid, 'start': now(), 'availability': availability, 'caption': caption, 'cursor': [], 'events': {}}
        self.t0 = self.cur['start']
        self.mark()

    def mark(self):
        self.cur['cursor'].append([now() - self.t0, *self.cursor])

    def event(self, name):
        """Named action shared by all lanes; the editor lines lanes up on these."""
        self.cur['events'][name] = now()

    def ready(self, settle):
        time.sleep(settle)
        self.cur['ready'] = now()
        time.sleep(.25)
        self.cur['end'] = now()
        self.features.append(self.cur)

    # -- pointer
    def glide(self, x, y, seconds=None, hover=False):
        """Move the composited cursor (and, for hover, the real DOM pointer)."""
        import math
        d = math.dist(self.cursor, (x, y))
        seconds = seconds or max(.4, min(1.0, .3 + d / 1600))
        self.mark()
        if hover:
            from marionette_driver.marionette import ActionSequence
            ActionSequence(m, 'pointer', 'live', {'pointerType': 'mouse'}).pointer_move(
                int(x), int(y), duration=int(seconds * 1000), origin='viewport').perform()
        else:
            time.sleep(seconds)
        self.cursor = (x, y)
        self.mark()

    def press(self, expr, seconds=None, event=None):
        """Glide the real pointer to a chrome control and click it for real."""
        from marionette_driver.marionette import ActionSequence
        x, y = center(expr)
        self.glide(x, y, seconds, hover=True)
        time.sleep(.12)
        self.mark()
        if event:
            self.event(event)
        ActionSequence(m, 'pointer', 'live', {'pointerType': 'mouse'}).pointer_down().pointer_up().perform()

    def click(self, code, pause=.12, event=None):
        time.sleep(pause)
        self.mark()
        if event:
            self.event(event)
        js(code)


def command(id_):
    return f"gURLBar.view.close();gURLBar.blur();document.getElementById('{id_}').dispatchEvent(new Event('command',{{bubbles:true}}))"


def type_query(take, text):
    for i in range(1, len(text) + 1):
        js('gURLBar.search(arguments[0])', text[:i])
        time.sleep(.09)


THEMED = LANE == 'themed'
FOLDER = 'document.querySelector(\'zen-folder[label="Web development"]\')'


def reset_work():
    js("gURLBar.view.close();gURLBar.blur();"
       "gZenWorkspaces.changeWorkspaceWithID(demoSpaces.Work).then(()=>gBrowser.selectedTab=demoTabs.find(t=>t.title==='CSS').tab)")
    time.sleep(1.2)


def f_folders(t):
    t.begin('work-space-essentials-and-real-documentation')
    time.sleep(.35)
    t.glide(*center(FOLDER + '.labelElement||' + FOLDER))
    t.click(FOLDER + '.collapsed=true', event='collapse')
    time.sleep(.9)
    t.click(FOLDER + '.collapsed=false', event='expand')
    t.ready(.9)


def f_space(t):
    t.begin('personal-space')
    time.sleep(.3)
    t.glide(*center('[...document.querySelectorAll("#zen-workspaces-button toolbarbutton")].find(b=>b.getAttribute("tooltiptext")==="Personal")'))
    t.click("gZenWorkspaces.changeWorkspaceWithID(demoSpaces.Personal).then(()=>gBrowser.selectedTab=demoTabs.find(t=>t.title==='Wikipedia').tab)",
            event='switch')
    t.ready(1.4)
    reset_work()


SIDEBAR_TOGGLE = ("document.getElementById('arc-sidebar-toggle')" if THEMED else
                  "[...document.querySelectorAll('toolbarbutton')].find(b=>b.getAttribute('tooltiptext')==='Toggle Compact Mode'&&b.getBoundingClientRect().width)")
LIBRARY_BUTTON = "document.getElementById('arc-gift-button')" if THEMED else "document.getElementById('zen-library-button')"
SPACES_TAB = ("[...document.querySelector('zen-library').querySelectorAll('label')].find(l=>l.textContent.trim()==='Spaces'"
              "&&l.getBoundingClientRect().width)")
MDN_TAB = "demoTabs.find(t=>t.title==='MDN Web Docs').tab"


def f_peek(t):
    # Same choreography in every lane: click the sidebar button, rest
    # mid-page, sweep to the left edge to peek, and back out.
    t.begin('hover-peek')
    time.sleep(.3)
    t.press(SIDEBAR_TOGGLE, event='hide')
    time.sleep(.8)
    t.glide(800, 420, .5, hover=True)
    time.sleep(.2)
    t.glide(1, 420, .7, hover=True)
    t.event('peek')
    time.sleep(1.3)
    t.event('unpeek')
    t.glide(800, 420, .6, hover=True)
    t.ready(.9)
    js('ZenArc.toggleDock()' if THEMED else 'gZenCompactModeManager.toggle(true)')
    time.sleep(1.2)


def f_command(t):
    t.begin('centered-command-bar')
    time.sleep(.4)
    t.event('open')
    js('gURLBar.focus();gURLBar.select()' if not THEMED else 'gURLBar.search("")')
    time.sleep(.35)
    type_query(t, 'split')
    t.event('typed')
    t.ready(.9)


def f_split(t):
    # Split the current page with the MDN tab, like Arc's "Open in Split View".
    t.begin('side-by-side-split-view')
    time.sleep(.3)
    js('gURLBar.view.close();gURLBar.blur()')
    t.glide(*center(MDN_TAB))
    time.sleep(.35)
    time.sleep(.35)  # Arc spends this in its tab context menu
    t.click("gZenViewSplitter.splitTabs([demoTabs.find(t=>t.title==='CSS').tab," + MDN_TAB + "],'vsep')", event='split')
    t.ready(2.0)
    js(command('cmd_zenSplitViewUnsplit'))
    time.sleep(1.5)
    reset_work()
    js("gBrowser.clearMultiSelectedTabs?.();for(const t of [...gBrowser.tabs])if(!demoTabs.some(d=>d.tab===t)&&!t.hasAttribute('zen-essential'))gBrowser.removeTab(t,{animate:false})")
    time.sleep(.5)


def close_library():
    js('ZenArc.setRail(false)' if THEMED else "document.querySelector('zen-library').constructor.animateProgress(0)")
    time.sleep(1.2)


def f_spaces(t):
    # Same choreography as Arc: open the library, then choose Spaces.
    t.begin('library-spaces')
    time.sleep(.3)
    t.press(LIBRARY_BUTTON, event='library')
    time.sleep(.6)
    t.press(SPACES_TAB, event='spaces')
    t.ready(1.6)
    close_library()


def f_flight(t):
    if not THEMED:
        t.begin('download-file-flight', 'unavailable', 'No native equivalent')
        time.sleep(.3)
        t.glide(1000, 300, hover=True)
        t.event('download')
        t.ready(1.0)
        return
    t.begin('download-file-flight')
    time.sleep(.3)
    t.glide(1000, 300)
    t.click('ZenArc.previewDownload({x:1000,y:300})', event='download')
    t.ready(2.4)


def f_live(t):
    t.begin('github-live-folders')
    time.sleep(.3)
    t.click("const {ZenLiveFoldersManager}=ChromeUtils.importESModule('resource:///modules/zen/ZenLiveFoldersManager.sys.mjs');"
            "ZenLiveFoldersManager.createFolder('github:pull-requests');ZenLiveFoldersManager.createFolder('github:issues');"
            "window.setTimeout(()=>{for(const f of document.querySelectorAll('zen-folder'))if(f.isLiveFolder)f.collapsed=false},300)",
            event='create')
    time.sleep(.9)
    try:
        t.glide(*center("[...document.querySelectorAll('zen-folder')].find(f=>f.isLiveFolder)?.labelElement"))
    except Exception:
        pass
    t.ready(.9)


FEATURES = [f_folders, f_space, f_peek, f_command, f_split, f_spaces, f_flight, f_live]


def cleanup():
    """Undo what a previous take left behind, so every take starts identically."""
    js("""try{window.demoArchiveStop?.()}catch(e){}
    if(window.demoRealIdle?.isConnected)gBrowser.removeTab(demoRealIdle,{animate:false});
    for(const f of [...document.querySelectorAll('zen-folder')].filter(f=>f.isLiveFolder))f.delete();
    for(const t of [...gBrowser.tabs])if(!demoTabs.some(d=>d.tab===t)&&!t.hasAttribute('zen-essential')&&gBrowser.tabs.length>1)gBrowser.removeTab(t,{animate:false});
    Services.prefs.setBoolPref('browser.urlbar.autoFill',false);""")
    time.sleep(1.0)


def record():
    cleanup()
    m.set_window_rect(x=0, y=30, width=1592, height=896)
    js("gURLBar.view.close();gURLBar.blur();window.focus()")
    reset_work()
    take = Take(OUT)
    take.start()
    try:
        for feature in FEATURES:
            if globals().get('ONLY') and feature.__name__ not in ONLY:
                continue
            feature(take)
            js('gURLBar.view.close();gURLBar.blur()')
            time.sleep(.4)
    finally:
        meta = take.stop()
    return {'features': [(f['id'], round(f['ready'] - f['start'], 2)) for f in meta['features']], 'frames': meta['frames']}
