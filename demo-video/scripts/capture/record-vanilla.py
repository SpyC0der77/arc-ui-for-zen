"""Record actual disposable vanilla Zen chrome; never uses Codex computer use.

python3 .../record-vanilla.py --manifest .../session.json --setup
python3 .../record-vanilla.py --manifest .../session.json
--close requests a graceful shutdown for either disposable session role.
"""
import argparse
import base64
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
DEMO = ROOT / 'demo-video'
sys.path.insert(0, str(ROOT / 'artifacts/test-python'))

SETUP = r"""
const icons=arguments[0],done=arguments[arguments.length-1];
(async()=>{
  if(window.demoTabs?.length)throw new Error('Session already prepared; use a fresh disposable profile.');
  const initialBlankTabs=[...gBrowser.tabs].filter(tab=>tab.linkedBrowser.currentURI.spec==='about:blank');
  if([...gBrowser.tabs].some(tab=>tab.linkedBrowser.currentURI.spec!=='about:blank'))
    throw new Error('Disposable profile already contains tabs. Create a fresh comparison session to avoid duplicate demo content.');
  const all=gZenWorkspaces.getWorkspaces();
  const work=all[0];if(!work)throw new Error('Native initial workspace is not ready.');
  work.name='Work';work.icon=icons.Work;await gZenWorkspaces.saveWorkspace(work);
  const personal=all.find(s=>s.name==='Personal')||await gZenWorkspaces.createAndSaveWorkspace('Personal',icons.Personal,false,0);
  const reading=all.find(s=>s.name==='Reading')||await gZenWorkspaces.createAndSaveWorkspace('Reading',icons.Reading,false,0);
  personal.icon=icons.Personal;reading.icon=icons.Reading;
  await gZenWorkspaces.saveWorkspace(personal);await gZenWorkspaces.saveWorkspace(reading);
  window.demoSpaces={Work:work.uuid,Personal:personal.uuid,Reading:reading.uuid};window.demoTabs=[];
  const specs=[['GitHub','https://github.com/','Work'],['MDN Web Docs','https://developer.mozilla.org/en-US/','Work'],['CSS','https://developer.mozilla.org/en-US/docs/Web/CSS','Work'],['Zen Browser','https://zen-browser.app/','Work'],['Wikipedia','https://en.wikipedia.org/wiki/Main_Page','Personal'],['YouTube','https://www.youtube.com/','Personal'],['Spotify','https://open.spotify.com/','Personal'],['Hacker News','https://news.ycombinator.com/','Reading'],['NASA Science','https://science.nasa.gov/','Reading']];
  for(const [title,url,space] of specs){
    await gZenWorkspaces.changeWorkspaceWithID(demoSpaces[space]);
    await new Promise(resolve=>setTimeout(resolve,300));
    const tab=gBrowser.addTab(url,{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true});
    demoTabs.push({tab,title,url,space});
    await new Promise(resolve=>setTimeout(resolve,300));
  }
  await gZenWorkspaces.changeWorkspaceWithID(demoSpaces.Work);
  await gZenFolders.createFolder(demoTabs.filter(t=>['MDN Web Docs','CSS'].includes(t.title)).map(t=>t.tab),{label:'Web development',workspaceId:work.uuid,renameFolder:false,collapsed:false});
  gZenPinnedTabManager.addToEssentials(demoTabs[0].tab);
  gBrowser.selectedTab=demoTabs.find(t=>t.title==='CSS').tab;
  for(const tab of initialBlankTabs)if(tab.isConnected)gBrowser.removeTab(tab,{animate:false});
  // Hide the automation indicator only; retain the real native UI and theme.
  const style=document.createElementNS('http://www.w3.org/1999/xhtml','style');style.textContent='#remote-control-box{display:none!important}';document.documentElement.append(style);
  done({ok:true,tabs:demoTabs.length,spaces:demoSpaces});
})().catch(e=>done({error:String(e),stack:e.stack}));
"""


def session_info(manifest, role):
    file = Path(manifest).resolve(strict=True)
    data = json.loads(file.read_text())
    root = Path(data['root']).resolve(strict=True)
    if (not data.get('disposable') or root.parent != (DEMO / 'runtime').resolve()
            or not root.name.startswith('comparison-') or file != root / 'session.json'):
        raise ValueError('Refusing to automate a non-disposable comparison session')
    session = data['sessions'][role]
    if Path(session['profile']).resolve() != root / role / 'profile':
        raise ValueError('Unexpected profile path in disposable manifest')
    expected_app=root/role/('Zen.app' if sys.platform=='darwin' else 'Zen')
    if Path(session['app']).resolve()!=expected_app:
        raise ValueError('Unexpected application path in disposable manifest')
    return session


def connect(info):
    from marionette_driver.marionette import Marionette
    deadline = time.monotonic() + 30
    while True:
        try:
            m = Marionette('localhost', port=info['port'], socket_timeout=60)
            m.start_session()
            m.set_context('chrome')
            m.timeout.script = 60
            actual = m.execute_script('return Services.dirsvc.get("ProfD",Ci.nsIFile).path')
            if Path(actual).resolve() != Path(info['profile']).resolve():
                m.delete_session()
                raise ValueError('Marionette port is attached to a different profile')
            return m
        except (ConnectionError, OSError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(.15)


def verify_shutdown_target(info):
    """A broken NewSession cannot confirm ProfD, so verify PID, binary and port.

    This fallback is only for the application generated by the guarded manifest.
    It never signals a process or changes its profile.
    """
    pid = int(info['pid'])
    app = Path(info['app']).resolve(strict=True)
    if sys.platform == 'win32':
        expected = app/'zen.exe'
        command = (f'$p=Get-Process -Id {pid} -ErrorAction Stop; '
                   f'$t=Get-NetTCPConnection -LocalPort {int(info["port"])} -State Listen -ErrorAction Stop; '
                   '@{exe=$p.Path;owners=@($t.OwningProcess)}|ConvertTo-Json -Compress')
        result = json.loads(subprocess.check_output(['powershell','-NoProfile','-Command',command],text=True))
        if Path(result['exe']).resolve()!=expected or pid not in result['owners']:
            raise ValueError('Disposable PID/executable/Marionette listener ownership did not match')
    else:
        expected = app/'Contents/MacOS/zen' if sys.platform=='darwin' else app/'zen'
        actual = subprocess.check_output(['ps','-p',str(pid),'-o','comm='],text=True).strip()
        if Path(actual).resolve()!=expected:
            raise ValueError('Disposable process executable did not match its manifest')
        listener = subprocess.check_output(['lsof','-nP','-a','-p',str(pid),f'-iTCP:{int(info["port"])}','-sTCP:LISTEN','-Fp'],text=True)
        if f'p{pid}' not in listener.splitlines():
            raise ValueError('Disposable process does not own the expected Marionette listener')


def graceful_close(info):
    from marionette_driver.marionette import Marionette
    from marionette_driver.errors import SessionNotCreatedException
    verify_shutdown_target(info)
    m=Marionette('localhost',port=info['port'],socket_timeout=15)
    try:
        try:
            m.start_session()
        except SessionNotCreatedException as error:
            if 'browserElement is null' not in str(error):
                raise
            # NewSession can fail after the last content browser is discarded.
            # Marionette's parent-process shutdown command remains available.
            response=m.client.request('Marionette:Quit',{'flags':['eAttemptQuit']})
            if response.error:
                raise RuntimeError(response.error)
            result=response.result
            if result.get('forced'):
                raise RuntimeError(f'Browser reported a forced shutdown: {result}')
            print(json.dumps({'gracefulShutdownRequested':True,'fallback':'Marionette:Quit',**result}))
            return
        m.set_context('chrome')
        actual=m.execute_script('return Services.dirsvc.get("ProfD",Ci.nsIFile).path')
        if Path(actual).resolve()!=Path(info['profile']).resolve():
            raise ValueError('Shutdown port is attached to a different profile')
        try:
            m.execute_script('Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit)')
        except Exception as error:
            if not any(s in str(error).lower() for s in ['connection','closed','socket','disconnected']):
                raise
        print(json.dumps({'gracefulShutdownRequested':True}))
    finally:
        if m.client is not None:
            m.client.close()


def setup(m):
    # Native Zen recognizes SVG icons by the .svg suffix. A data: URI is
    # rendered as literal label text in this build; use the original SVG assets
    # through their actual local file URLs instead.
    icons = {name: (DEMO / 'assets' / (asset+'.svg')).as_uri()
             for name, asset in [('Work','briefcase-business'),('Personal','house'),('Reading','book-open')]}
    # Match the original demo's native browser coordinate system.
    m.set_window_rect(x=0, y=30, width=1592, height=896)
    result = m.execute_async_script(SETUP, script_args=[icons])
    if not result.get('ok'):
        raise RuntimeError(result)
    deadline = time.monotonic()+45
    while time.monotonic() < deadline:
        if m.execute_script('return demoTabs.every(t=>!t.tab.linkedBrowser.isLoadingDocument)'):
            break
        time.sleep(.2)
    else:
        raise RuntimeError('Demo websites did not finish loading; capture was not started')
    time.sleep(1)
    health=m.execute_script('return {tabs:gBrowser.tabs.length,connected:demoTabs.map(t=>t.tab.isConnected),selected:!!gBrowser.selectedBrowser,viewport:[innerWidth,innerHeight]}')
    if not health['selected'] or not all(health['connected']):
        raise RuntimeError(f'Native setup lost its demo tabs: {health}')
    review=DEMO/'review'
    review.mkdir(exist_ok=True)
    (review/'comparison-setup.png').write_bytes(base64.b64decode(m.screenshot()))
    result['health']=health
    return result


def screenshot_png(m):
    """Capture real browser chrome, including during native split transitions.

    Gecko's cross-process drawSnapshot path can fail while split browsers are
    being reparented. Its native compositor readback is an alternate capture
    path for that same real window, not a reconstruction of the interface.
    """
    try:
        return base64.b64decode(m.screenshot())
    except Exception as error:
        if 'Unable to capture screenshot' not in str(error):
            raise
        encoded = m.execute_script('''
          const canvas=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
          canvas.width=innerWidth;canvas.height=innerHeight;
          const ctx=canvas.getContext('2d');
          ctx.drawWindow(window,0,0,innerWidth,innerHeight,'rgb(255,255,255)',
            ctx.DRAWWINDOW_DRAW_VIEW|ctx.DRAWWINDOW_USE_WIDGET_LAYERS);
          return canvas.toDataURL('image/png').split(',')[1];
        ''')
        return base64.b64decode(encoded)


class Recorder:
    def __init__(self, m, output):
        self.m, self.output = m, output
        output.parent.mkdir(parents=True, exist_ok=True)
        self.fps = 20
        self.frame = 0
        self.shots = []
        self.completed = False
        self.ff = subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate',str(self.fps),'-vcodec','png','-i','-','-vf','scale=1920:1080:flags=lanczos,fps=30','-an','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(output)], stdin=subprocess.PIPE)

    def js(self, code):
        return self.m.execute_script(code)

    def shot(self, name, action='', *, settle=1.1, predicate='true', camera=(0,0,720,1080), availability='native', notes=''):
        start = self.frame/self.fps
        # Record the initial state before the real native action; no reconstructed UI.
        self.js('window.demoActionError=null;window.setTimeout(()=>{try{'+action+'}catch(e){window.demoActionError=String(e)}},140)')
        began = time.monotonic()
        ready = None
        for index in range(self.fps*20):
            png = screenshot_png(self.m)
            self.ff.stdin.write(png)
            self.frame += 1
            elapsed = self.frame/self.fps-start
            error = self.js('return window.demoActionError')
            if error:
                raise RuntimeError(f'{name}: {error}')
            if elapsed >= settle and self.js('return Boolean('+predicate+')'):
                ready = elapsed
                break
            delay = began + (index+1)/self.fps - time.monotonic()
            if delay > 0:
                time.sleep(delay)
        if ready is None:
            raise RuntimeError(f'{name}: native completion condition timed out')
        # A complete extra source frame covers ceil-to-30fps checkpoint rounding.
        self.ff.stdin.write(screenshot_png(self.m))
        self.frame += 1
        slug = re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-')
        review = DEMO/'review'/'comparison-vanilla'
        review.mkdir(parents=True, exist_ok=True)
        (review/(slug+'.png')).write_bytes(png)
        shot = {'id':slug,'name':name,'source':str(self.output),'start':start,'end':self.frame/self.fps,
                'ready':math.ceil(ready*30)/30,'camera':list(camera),'availability':availability,'notes':notes}
        self.shots.append(shot)
        print(json.dumps(shot),flush=True)

    def command(self, command):
        # Fail rather than silently substitute a made-up native control.
        return f"gURLBar.view.close();gURLBar.blur();{{const c=document.getElementById({json.dumps(command)});if(!c)throw new Error('Missing native command: '+{json.dumps(command)});c.dispatchEvent(new Event('command',{{bubbles:true}}));}}"

    def library(self, tab):
        return f"gURLBar.view.close();gURLBar.blur();{{const lib=document.querySelector('zen-library');if(!lib||typeof lib.constructor.animateProgress!=='function')throw new Error('Native Zen library unavailable');lib.activeTab={json.dumps(tab)};lib.constructor.animateProgress(1).catch(e=>window.demoActionError=String(e));}}"

    def record(self):
        self.js("if(window.ZenArc)throw new Error('Vanilla recorder refuses a themed browser');if(!window.demoTabs)throw new Error('Run --setup first');gURLBar.view.close();gURLBar.blur();gBrowser.selectedTab=demoTabs.find(t=>t.title==='CSS').tab;")
        downloaded=self.m.execute_async_script("""const done=arguments[arguments.length-1];(async()=>{const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');const list=await Downloads.getList(Downloads.PUBLIC);const d=await Downloads.createDownload({source:arguments[0],target:arguments[1]});await list.add(d);await d.start();done(d.succeeded)})().catch(e=>done({error:String(e)}))""",script_args=[(DEMO/'assets/wallpaper.jpg').as_uri(),str(self.output.parent/'Mountain landscape vanilla.jpg')])
        if downloaded is not True:
            raise RuntimeError(f'Native local image download failed: {downloaded}')
        self.shot('Work space, Essentials and real documentation')
        self.shot('Collapsed folder',"document.querySelector('zen-folder[label=\"Web development\"]').collapsed=true",predicate="document.querySelector('zen-folder[label=\"Web development\"]').collapsed")
        self.shot('Expanded folder',"document.querySelector('zen-folder[label=\"Web development\"]').collapsed=false",predicate="!document.querySelector('zen-folder[label=\"Web development\"]').collapsed")
        for title,space,page in [('Personal Space','Personal','Wikipedia'),('Reading Space','Reading','Hacker News'),('Back to Work','Work','CSS')]:
            self.shot(title,f"gZenWorkspaces.changeWorkspaceWithID(demoSpaces.{space}).then(()=>gBrowser.selectedTab=demoTabs.find(t=>t.title==={json.dumps(page)}).tab)",predicate=f"gBrowser.selectedTab===demoTabs.find(t=>t.title==={json.dumps(page)}).tab")
        self.shot('Undock the sidebar','gZenCompactModeManager.toggle(true)')
        # Native pointer actions are executed programmatically, without Computer Use.
        from marionette_driver.marionette import ActionSequence
        ActionSequence(self.m,'pointer','vanilla',{'pointerType':'mouse'}).pointer_move(1,400,origin='viewport').perform()
        self.shot('Hover peek',"",notes='Native pointer hover',settle=.8)
        ActionSequence(self.m,'pointer','vanilla',{'pointerType':'mouse'}).pointer_move(700,400,origin='viewport').perform()
        self.shot('Full page with hidden sidebar','',settle=.8)
        self.shot('Dock the sidebar','gZenCompactModeManager.toggle(true)')
        for title,delta in [('Resize sidebar',56),('Restore sidebar width',-56)]:
            splitter = self.m.find_element('id','zen-sidebar-splitter')
            ActionSequence(self.m,'pointer','vanilla',{'pointerType':'mouse'}).pointer_move(0,0,origin=splitter).pointer_down().pointer_move(delta,0,duration=400,origin='pointer').pointer_up().perform()
            self.shot(title)
        center=(600,0,720,1080)
        self.shot('Centered command bar',"gURLBar.search('split')",camera=center,notes='Native address bar search; Arc-style command suggestions are not supplied by the theme')
        self.shot('Side by side split view',self.command('cmd_zenSplitViewVertical'),camera=center)
        self.shot('Unsplit command',"gURLBar.search('unsplit')",camera=center)
        self.shot('Return to one page',self.command('cmd_zenSplitViewUnsplit'),camera=center)
        self.shot('Horizontal split command',"gURLBar.search('split horizontal')",camera=center)
        self.shot('Top to bottom split',self.command('cmd_zenSplitViewHorizontal'),camera=center)
        self.shot('Unsplit horizontal view',self.command('cmd_zenSplitViewUnsplit'),camera=center)
        self.shot('Downloads command',"gURLBar.search('downloads')",camera=center)
        # Native library panes are used where this Zen build exposes them.
        for title,tab in [('Library downloads','downloads'),('Library Spaces','spaces'),('Media library','media')]:
            self.shot(title,self.library(tab))
        self.shot('Return from library',"document.querySelector('zen-library').constructor.animateProgress(0)")
        self.shot('Downloads hover menu',"DownloadsPanel.showPanel()",camera=(1200,0,720,1080),notes='Native Downloads popup, opened via its native API')
        for name in ['Download file flight','Hidden sidebar download']:
            self.shot(name,"DownloadsPanel.hidePanel()",availability='unavailable',notes='Arc UI download flight has no corresponding vanilla Zen animation; unchanged native page is shown')
        self.shot('Dock after download')
        self.shot('GitHub Live Folders',"const {ZenLiveFoldersManager}=ChromeUtils.importESModule('resource:///modules/zen/ZenLiveFoldersManager.sys.mjs');ZenLiveFoldersManager.createFolder('github:pull-requests');ZenLiveFoldersManager.createFolder('github:issues');for(const f of document.querySelectorAll('zen-folder'))if(f.isLiveFolder)f.collapsed=false",settle=1.5)
        self.shot('Boosts library',self.library('boosts'))
        self.shot('Archive command',"document.querySelector('zen-library').constructor.animateProgress(0);gURLBar.search('archive')",camera=center)
        self.shot('JavaScript reference as a background tab',"gURLBar.view.close();gURLBar.blur();window.demoRealIdle=gBrowser.addTab('https://developer.mozilla.org/en-US/docs/Web/JavaScript',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true})",settle=2,predicate='!demoRealIdle.linkedBrowser.isLoadingDocument')
        self.shot('Auto archive JavaScript reference','',availability='unavailable',notes='Arc UI auto-archive is not installed in this vanilla profile; tab remains visible')
        self.shot('Archive library',"gBrowser.removeTab(demoRealIdle,{animate:false});"+self.library('history'),notes='Native closed-tab history after explicitly closing the background tab')
        self.shot('Restore JavaScript reference',self.command('History:UndoCloseTab')+"document.querySelector('zen-library').constructor.animateProgress(0)",settle=1.5)
        self.shot('Finish on Work',"gBrowser.selectedTab=demoTabs.find(t=>t.title==='CSS').tab")
        self.completed = True

    def close(self):
        try:
            self.ff.stdin.close()
        except BrokenPipeError:
            pass
        encoded=self.ff.wait()==0
        self.completed=self.completed and encoded
        metadata=self.output.with_suffix('.json' if self.completed else '.partial.json')
        metadata.write_text(json.dumps({'completed':self.completed,'fps':30,'width':1920,'height':1080,'shots':self.shots},indent=2))
        if not encoded:
            raise RuntimeError('FFmpeg capture encoding failed; partial metadata was preserved')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest',required=True)
    parser.add_argument('--role',choices=['themed','vanilla'],default='vanilla')
    mode=parser.add_mutually_exclusive_group()
    mode.add_argument('--setup',action='store_true')
    mode.add_argument('--setup-and-record',action='store_true')
    mode.add_argument('--close',action='store_true')
    parser.add_argument('--output',type=Path,default=DEMO/'recordings/comparison/vanilla.mp4')
    args=parser.parse_args()
    info=session_info(args.manifest,args.role)
    if args.close:
        graceful_close(info)
        return
    m=connect(info)
    try:
        if args.setup:
            print(json.dumps(setup(m)))
            return
        if args.setup_and_record:
            print(json.dumps(setup(m)),flush=True)
        if args.role!='vanilla':
            raise ValueError('Use the original capture scripts for the themed role')
        recorder=Recorder(m,args.output.resolve())
        try:recorder.record()
        finally:recorder.close()
    finally:
        if not args.close:m.delete_session()


if __name__=='__main__':
    main()
