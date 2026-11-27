"""Isolated bento captures of the themed disposable Zen (Windows).

Run inside marionette-host.py (it provides `m` and `info`) for the themed role:

    OUT='demo-video/recordings/windows/bento'; exec(open('bento_zen.py').read()); result=capture()

Every image is a real window frame from window-recorder.exe (Windows.Graphics.
Capture; the window may stay behind other windows), cropped to one feature
element, so no page background, ad or unrelated UI is in it:

  iso-command.png    the command bar with "Open Archive" selected
  iso-downloads.png  the downloads hover popup (a real local-file download)
  iso-library.png    the library rail with the downloads list
  iso-split.png      a split of two calm pages
  iso-flight.png     the download-flight motion trail over a blank page with the
                     sidebar hidden (white, keyed out by polished.py)
  iso-live.png       the GitHub Live Folders "Pull Requests" and "Issues"
"""
import json
import subprocess
import sys
import time
from pathlib import Path

ROOTDIR = Path(__file__).resolve().parents[3] if '__file__' in globals() else Path.cwd()
sys.path.insert(0, str(ROOTDIR / 'demo-video/scripts/capture'))
import win_native as W  # noqa: E402
from PIL import Image, ImageChops  # noqa: E402

DOWNLOAD = r"""
const [files,done]=arguments;
(async()=>{
  const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
  const list=await Downloads.getList(Downloads.ALL);
  for(const d of await list.getAll()){await list.remove(d);await d.finalize(true);}
  // Disposable profile only: forget earlier downloads, which the library reads from history.
  const {PlacesUtils}=ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
  await PlacesUtils.history.clear();
  for(const [src,dest] of files){
    const d=await Downloads.createDownload({source:src,target:dest});
    await list.add(d);await d.start();if(!d.succeeded)throw new Error('download failed');
    await new Promise(r=>setTimeout(r,400));
  }
  done({ok:true});
})().catch(e=>done({error:String(e)}));
"""


def js(code, *args):
    return m.execute_script(code, script_args=list(args))


def rect(expr):
    r = js('const e=(' + expr + ');if(!e)return null;const b=e.getBoundingClientRect();return [b.x,b.y,b.width,b.height]')
    if not r or r[2] <= 0:
        raise RuntimeError('No visible element for ' + expr)
    return r


def union(*rects):
    x0 = min(r[0] for r in rects)
    y0 = min(r[1] for r in rects)
    x1 = max(r[0] + r[2] for r in rects)
    y1 = max(r[1] + r[3] for r in rects)
    return [x0, y0, x1 - x0, y1 - y0]


class Grabber:
    def __init__(self, out):
        self.out = Path(out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.tmp = self.out / '_tmp'
        self.tmp.mkdir(exist_ok=True)
        win = W.main_window(js('return Services.appinfo.processID'), (1592, 896))
        self.hwnd = win['id']
        # Chrome CSS pixels -> window frame pixels (100% scale: an offset only).
        sx, sy = js('return [mozInnerScreenX, mozInnerScreenY]')
        self.dx, self.dy = round(sx - win['bounds']['X']), round(sy - win['bounds']['Y'])

    def frame(self, name='frame'):
        """One real window frame, as the compositor shows it."""
        mp4 = self.tmp / f'{name}.mp4'
        rec = subprocess.Popen([str(W.RECORDER), str(self.hwnd), str(mp4), '60'], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, text=True)
        json.loads(rec.stdout.readline())
        js('document.documentElement.style.outline="0px solid transparent"')
        time.sleep(.35)
        rec.stdin.close()
        rec.stdout.read()
        rec.wait()
        png = self.tmp / f'{name}.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-sseof', '-0.1', '-i', str(mp4), '-frames:v', '1',
                        '-update', '1', str(png)], check=True)
        return Image.open(png).convert('RGB')

    def crop(self, img, r, pad=0, padv=None):
        x, y, w, h = r
        padv = pad if padv is None else padv
        # Never include the 1 px window border.
        return img.crop((max(self.dx, round(x + self.dx - pad)), max(self.dy, round(y + self.dy - padv)),
                         min(img.width - 1, round(x + w + self.dx + pad)), min(img.height - 1, round(y + h + self.dy + padv))))

    def save(self, img, name):
        path = self.out / name
        img.save(path)
        return {name: list(img.size)}


def blank_tab():
    """A white about:blank tab in Work, selected (removed again by cleanup)."""
    js("gURLBar.view.close();gURLBar.blur();"
       "window.demoBlank=gBrowser.addTab('about:blank',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true});"
       "gBrowser.selectedTab=demoBlank")
    time.sleep(1.0)


def close_blank():
    js("if(window.demoBlank?.isConnected)gBrowser.removeTab(demoBlank,{animate:false});"
       "gBrowser.selectedTab=demoTabs.find(t=>t.title==='CSS').tab")
    time.sleep(.6)


def shot_command(g):
    blank_tab()
    js('gURLBar.search("archive")')
    time.sleep(1.0)
    # Select the command row, so "Open Archive" is the highlighted result.
    js("const rows=[...gURLBar.view.panel.querySelectorAll('.urlbarView-row')];"
       "const i=rows.findIndex(r=>r.textContent.includes('Open Archive'));gURLBar.view.selectedRowIndex=i")
    time.sleep(.5)
    img = g.frame('command')
    out = g.save(g.crop(img, rect('document.getElementById("urlbar")'), 18), 'iso-command.png')
    js('gURLBar.view.close();gURLBar.blur()')
    close_blank()
    return out


def shot_downloads(g):
    blank_tab()
    js('ZenArc.openDownloads()')
    time.sleep(1.0)
    img = g.frame('downloads')
    out = g.save(g.crop(img, rect('document.getElementById("arc-download-popup")')), 'iso-downloads.png')
    js('ZenArc.hideDownloads()')
    time.sleep(.5)
    close_blank()
    return out


LIB_LABEL = ("[...document.querySelector('zen-library').querySelectorAll('label')]"
             ".find(l=>l.textContent.trim()==='{}'&&l.getBoundingClientRect().width)")


def shot_library(g):
    js('ZenArc.setRail(true)')
    time.sleep(1.4)
    js(LIB_LABEL.format('Downloads') + '.click()')
    time.sleep(1.0)
    js('document.activeElement?.blur?.();document.querySelector("zen-library").focus?.()')
    time.sleep(.4)
    img = g.frame('library')
    out = g.save(g.crop(img, rect('document.querySelector("zen-library")')), 'iso-library.png')
    js('ZenArc.setRail(false)')
    time.sleep(1.2)
    return out


CALM = [('Mountain', 'https://en.wikipedia.org/wiki/Mountain'),
        ('Alps', 'https://en.wikipedia.org/wiki/Alps')]


def shot_split(g):
    js("""window.demoCalm=arguments[0].map(([t,u])=>gBrowser.addTab(u,{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true}));
          gBrowser.selectedTab=demoCalm[0];""", CALM)
    deadline = time.time() + 30
    while time.time() < deadline and not js('return demoCalm.every(t=>!t.linkedBrowser.isLoadingDocument)'):
        time.sleep(.3)
    time.sleep(1.0)
    js("gZenViewSplitter.splitTabs(demoCalm,'vsep')")
    time.sleep(2.0)
    img = g.frame('split')
    area = rect("document.getElementById('tabbrowser-tabpanels')")
    out = g.save(g.crop(img, area), 'iso-split.png')
    js("document.getElementById('cmd_zenSplitViewUnsplit').dispatchEvent(new Event('command',{bubbles:true}))")
    time.sleep(1.5)
    js("for(const t of demoCalm)if(t.isConnected)gBrowser.removeTab(t,{animate:false});"
       "gBrowser.selectedTab=demoTabs.find(t=>t.title==='CSS').tab")
    time.sleep(.8)
    return out


def shot_flight(g):
    """A motion trail: the real flight animation paused at several moments, each
    frame captured, composited by darkening over the blank page."""
    blank_tab()
    js('ZenArc.toggleDock()')
    time.sleep(1.4)
    base = g.frame('flight-base')
    # Launched near the hidden sidebar's gift, so the arc is compact and tall.
    js("window.demoFlight=ZenArc.previewDownload({clientX:330,clientY:420});")
    time.sleep(.05)
    js("for(const a of document.querySelector('[data-arc-flight]').getAnimations())a.pause()")
    stamps = [90, 300, 520, 760, 1000, 1180, 1340, 1470]
    frames = []
    for k, ms in enumerate(stamps):
        js("for(const a of document.querySelector('[data-arc-flight]').getAnimations())a.currentTime=arguments[0]", ms)
        time.sleep(.25)
        frames.append(g.frame(f'flight{k}'))
    js("for(const a of document.querySelector('[data-arc-flight]')?.getAnimations()||[])a.finish()")
    time.sleep(1.0)
    js('ZenArc.hideDownloads()')
    trail = Image.new('RGB', base.size, (255, 255, 255))
    for k, f in enumerate(frames):
        # Only what the sprite changed, fading in along the path.
        diff = ImageChops.difference(f, base).convert('L').point(lambda v: 255 if v > 6 else 0)
        alpha = .3 + .7 * ((k + 1) / len(frames)) ** 1.5
        layer = Image.blend(Image.new('RGB', base.size, (255, 255, 255)), f, alpha)
        trail.paste(ImageChops.darker(trail, layer), (0, 0), diff)
    content = rect("document.getElementById('tabbrowser-tabpanels')")
    trail = g.crop(trail, content)
    box = ImageChops.difference(trail, Image.new('RGB', trail.size, (255, 255, 255))).convert('L') \
        .point(lambda v: 255 if v > 4 else 0).getbbox()
    if not box:
        raise RuntimeError('Flight trail is empty')
    pad = 24
    trail = trail.crop((max(0, box[0] - pad), max(0, box[1] - pad),
                        min(trail.width, box[2] + pad), min(trail.height, box[3] + pad)))
    out = g.save(trail, 'iso-flight.png')
    js('ZenArc.toggleDock()')
    time.sleep(1.2)
    close_blank()
    return out


def shot_live(g):
    js("const {ZenLiveFoldersManager}=ChromeUtils.importESModule('resource:///modules/zen/ZenLiveFoldersManager.sys.mjs');"
       "ZenLiveFoldersManager.createFolder('github:pull-requests');ZenLiveFoldersManager.createFolder('github:issues');")
    time.sleep(1.5)
    js("for(const f of document.querySelectorAll('zen-folder'))if(f.isLiveFolder)f.collapsed=false")
    time.sleep(1.5)
    folders = js("return [...document.querySelectorAll('zen-folder')].filter(f=>f.isLiveFolder)"
                 ".map(f=>{const b=f.getBoundingClientRect();return [b.x,b.y,b.width,b.height]})")
    if len(folders) != 2:
        raise RuntimeError(f'Expected two live folders, found {len(folders)}')
    img = g.frame('live')
    out = g.save(g.crop(img, union(*folders), 4, 0), 'iso-live.png')
    js("for(const f of [...document.querySelectorAll('zen-folder')].filter(f=>f.isLiveFolder))f.delete()")
    time.sleep(.8)
    return out


def capture(only=None):
    if not js('return !!window.ZenArc'):
        raise RuntimeError('Bento captures need the themed disposable Zen')
    js("gURLBar.view.close();gURLBar.blur();gZenWorkspaces.changeWorkspaceWithID(demoSpaces.Work)"
       ".then(()=>gBrowser.selectedTab=demoTabs.find(t=>t.title==='CSS').tab)")
    time.sleep(1.2)
    g = Grabber(OUT)
    profile = Path(info['profile'])
    assets = ROOTDIR / 'demo-video/assets'
    # A second real image: a crop of the wallpaper (a file type with a
    # thumbnail, so no system default-app icon shows up in the list).
    detail = profile.parent / 'Glow detail.jpg'
    Image.open(assets / 'wallpaper.jpg').convert('RGB').crop((1900, 1500, 2900, 2300)).save(detail, quality=92)
    files = [[detail.as_uri(), str(profile.parent / 'downloads' / 'Glow detail.jpg')],
             [(assets / 'wallpaper.jpg').resolve().as_uri(), str(profile.parent / 'downloads' / 'Wallpaper.jpg')]]
    done = m.execute_async_script(DOWNLOAD, script_args=[files])
    if not done.get('ok'):
        raise RuntimeError(done)
    results = {}
    for fn in (shot_command, shot_downloads, shot_library, shot_split, shot_flight, shot_live):
        if only and fn.__name__ not in only:
            continue
        results.update(fn(g))
    return results
