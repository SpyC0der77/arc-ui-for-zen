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
ff=subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','20','-vcodec','png','-i','-','-vf','scale=1920:1080:flags=lanczos,fps=30','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'controls.mp4')],stdin=subprocess.PIPE)
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
  if i==round(duration*20)-1:(DEMO/'review'/('control-'+str(len(shots)).zfill(2)+'.png')).write_bytes(b)
  delay=start+(i+1)/20-time.monotonic()
  if delay>0:time.sleep(delay)
 print(name,flush=True)
try:
 js("gBrowser.selectedTab=window.demoTabs.find(t=>t.title==='MDN Web Docs').tab")
 folder=m.find_element('css selector','zen-folder[label="Web development"] .tab-group-label-container')
 ActionSequence(m,'pointer','control',{'pointerType':'mouse'}).click(folder).perform()
 shot('Collapsed folder')
 ActionSequence(m,'pointer','control',{'pointerType':'mouse'}).click(folder).perform()
 shot('Expanded folder')
 ActionSequence(m,'pointer','control',{'pointerType':'mouse'}).click(m.find_element('id','PanelUI-menu-button')).perform()
 shot('Native application menu',duration=4)
 js("document.getElementById('appMenu-popup')?.hidePopup()")
 splitter=m.find_element('id','zen-sidebar-splitter')
 ActionSequence(m,'pointer','control',{'pointerType':'mouse'}).pointer_move(0,0,origin=splitter).pointer_down().pointer_move(56,0,duration=400,origin='pointer').pointer_up().perform()
 shot('Resize sidebar',duration=3.5)
 ActionSequence(m,'pointer','control',{'pointerType':'mouse'}).pointer_move(0,0,origin=splitter).pointer_down().pointer_move(-56,0,duration=400,origin='pointer').pointer_up().perform()
 shot('Restore sidebar width',duration=3.5)
finally:
 ff.stdin.close();ff.wait();(DEMO/'timeline'/'controls-shots.json').write_text(json.dumps(shots,indent=2));m.delete_session()
