import sys,time,base64,json,subprocess,ctypes
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'artifacts/test-python'))
from marionette_driver.marionette import Marionette,ActionSequence
ROOT=Path(__file__).resolve().parents[3];DEMO=ROOT/'demo-video';OUT=DEMO/'recordings'
import os
os.chdir(ROOT)
m=Marionette('localhost',port=2828,socket_timeout=60);m.start_session();m.set_context('chrome')
# Native app chrome and genuine website content. No reconstructed interface.
m.execute_script("gBrowser.selectedTab=window.demoTabs.find(t=>t.title==='CSS').tab;gURLBar.view.close();gURLBar.blur();window.focus();")
ff=subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','20','-vcodec','png','-i','-','-vf','scale=1920:1080:flags=lanczos,fps=30','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'details.mp4')],stdin=subprocess.PIPE)
shots=[];frame=0

def js(s): return m.execute_script(s)
def later(s): js('window.setTimeout(()=>{'+s+'},140)')
def move(x,y): ActionSequence(m,'pointer','demo',{'pointerType':'mouse'}).pointer_move(x,y,origin='viewport').perform()
def shot(name,s=None,duration=3.5):
 global frame
 if s:later(s)
 shots.append({'name':name,'start':frame/20,'duration':duration})
 start=time.monotonic();last=None
 for i in range(round(duration*20)):
  b=base64.b64decode(m.screenshot());ff.stdin.write(b);frame+=1
  if i==round(duration*20)-1:(DEMO/'review'/('detail-'+str(len(shots)).zfill(2)+'.png')).write_bytes(b)
  delay=start+(i+1)/20-time.monotonic()
  if delay>0:time.sleep(delay)
 print(name,flush=True)
try:
 shot('New tab command bar',"gURLBar.search('developer.mozilla.org')")
 shot('Close command bar',"gURLBar.view.close();gURLBar.blur()")
 shot('Horizontal split command',"gURLBar.search('split horizontal')")
 shot('Top to bottom split',"gURLBar.view.close();gURLBar.blur();document.getElementById('cmd_zenSplitViewHorizontal').dispatchEvent(new Event('command',{bubbles:true}))",4)
 shot('Unsplit horizontal view',"document.getElementById('cmd_zenSplitViewUnsplit').dispatchEvent(new Event('command',{bubbles:true}))")
 # Native live folders are created without using any private GitHub session.
 js("const {ZenLiveFoldersManager}=ChromeUtils.importESModule('resource:///modules/zen/ZenLiveFoldersManager.sys.mjs');window.demoLiveManager=ZenLiveFoldersManager;window.demoLiveManager.createFolder('github:pull-requests');window.demoLiveManager.createFolder('github:issues');")
 shot('GitHub Live Folders',"for(const f of document.querySelectorAll('zen-folder'))if(f.isLiveFolder)f.collapsed=false",4)
 # Run the installed auto-archive code with one genuine, visited tab aged 13 hours.
 js("window.demoIdleTab=gBrowser.addTab('https://example.com/',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true})")
 shot('Background tab before auto archive',duration=3.5)
 source=Path('payload/content/features/archive/auto-archive.js').read_text(encoding='utf-8')
 info=source[source.index('  function archiveTabInfo'):source.index('  // Zen keeps the table')]
 announce=source[source.index('  function announceArchive'):source.index('  if (!PrivateBrowsingUtils.isWindowPrivate(window))',source.index('  function announceArchive'))]
 js("const fixture={};Services.scriptloader.loadSubScript('chrome://arc-ui/content/archive.js',fixture,'UTF-8');const later=(fn,ms)=>window.setTimeout(fn,ms);const animate=(node,frames,options)=>node.animate(frames,options).finished;"+info+announce+"window.demoIdleTab._lastAccessed=Date.now()-13*3600000;window.demoArchiveStop=fixture.ArcArchive.start({tabs:()=>[archiveTabInfo(window.demoIdleTab)],close:row=>gBrowser.removeTab(row.tab,{animate:false}),announce:announceArchive,getHours:()=>12,schedule:later,cancel:clearTimeout,delay:600,interval:3600000});")
 shot('Auto archive idle tab',duration=4)
 shot('Archive holds the idle tab',"document.querySelector('zen-library').activeTab='history';ZenArc.setRail(true)",4)
 shot('Boosts library',"document.querySelector('zen-library').activeTab='boosts'",3.5)
 shot('Finish on the workspace',"ZenArc.setRail(false)",3.5)
finally:
 ff.stdin.close();ff.wait();(DEMO/'timeline'/'details-shots.json').write_text(json.dumps(shots,indent=2));m.delete_session()
print('Recorded',frame/20,'seconds')
