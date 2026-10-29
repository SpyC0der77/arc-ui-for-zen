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
ff=subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','20','-vcodec','png','-i','-','-vf','scale=1920:1080:flags=lanczos,fps=30','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'archive-real.mp4')],stdin=subprocess.PIPE)
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
  if i==round(duration*20)-1:(DEMO/'review'/('archive-real-'+str(len(shots)).zfill(2)+'.png')).write_bytes(b)
  delay=start+(i+1)/20-time.monotonic()
  if delay>0:time.sleep(delay)
 print(name,flush=True)
try:
 js("window.demoRealIdle=gBrowser.addTab('https://developer.mozilla.org/en-US/docs/Web/JavaScript',{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal(),skipAnimation:true});")
 for _ in range(100):
  if not js('return window.demoRealIdle.linkedBrowser.isLoadingDocument'):break
  time.sleep(.1)
 shot('JavaScript reference as a background tab',duration=3.5)
 source=Path('payload/arc.uc.js').read_text(encoding='utf-8')
 info=source[source.index('  function archiveTabInfo'):source.index('  // Zen keeps the table')]
 announce=source[source.index('  function announceArchive'):source.index('  if (!PrivateBrowsingUtils.isWindowPrivate(window))',source.index('  function announceArchive'))]
 js("const fixture={};Services.scriptloader.loadSubScript('chrome://arc-ui/content/archive.js',fixture,'UTF-8');const later=(fn,ms)=>window.setTimeout(fn,ms);const animate=(node,frames,options)=>node.animate(frames,options).finished;"+info+announce+"window.demoRealIdle._lastAccessed=Date.now()-13*3600000;window.demoRealArchiveStop=fixture.ArcArchive.start({tabs:()=>[archiveTabInfo(window.demoRealIdle)],close:row=>gBrowser.removeTab(row.tab,{animate:false}),announce:announceArchive,getHours:()=>12,schedule:later,cancel:clearTimeout,delay:600,interval:3600000});")
 shot('Auto archive JavaScript reference',duration=4)
 shot('Archive library',"document.querySelector('zen-library').activeTab='history';ZenArc.setRail(true)",4)
 shot('Restore JavaScript reference',"const row=[...document.querySelectorAll('zen-library .zen-library-row')].find(e=>e.textContent.includes('JavaScript'));if(row)row.click();window.setTimeout(()=>ZenArc.setRail(false),450)",4.5)
 shot('Finish on Work',"gBrowser.selectedTab=window.demoTabs.find(t=>t.title==='CSS').tab",3.5)
finally:
 ff.stdin.close();ff.wait();(DEMO/'timeline'/'archive-real-shots.json').write_text(json.dumps(shots,indent=2));m.delete_session()
