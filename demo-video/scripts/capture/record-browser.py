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
# A real local image download is available for the download actions and media view.
print(m.execute_async_script('''const done=arguments[arguments.length-1];(async()=>{const {Downloads}=ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');window.demoDownloadList=await Downloads.getList(Downloads.PUBLIC);const d=await Downloads.createDownload({source:arguments[0],target:arguments[1]});await demoDownloadList.add(d);await d.start();window.demoDownload=d;done(d.succeeded)})().catch(e=>done(String(e)))''',script_args=[(DEMO/'assets/wallpaper.jpg').as_uri(),str(OUT/'Mountain landscape.jpg')]))
time.sleep(3)
ff=subprocess.Popen(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','image2pipe','-framerate','20','-vcodec','png','-i','-','-vf','scale=1920:1080:flags=lanczos,fps=30','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(OUT/'browser.mp4')],stdin=subprocess.PIPE)
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
  if i==round(duration*20)-1:(DEMO/'review'/('shot-'+str(len(shots)).zfill(2)+'.png')).write_bytes(b)
  delay=start+(i+1)/20-time.monotonic()
  if delay>0:time.sleep(delay)
 print(name,flush=True)
try:
 shot('Work space, Essentials and real documentation')
 shot('Collapse Web development folder',"document.querySelector('zen-folder[label=\"Web development\"]').collapsed=true")
 shot('Expand Web development folder',"document.querySelector('zen-folder[label=\"Web development\"]').collapsed=false")
 shot('Personal Space',"gZenWorkspaces.changeWorkspaceWithID(window.demoSpaces.Personal).then(()=>gBrowser.selectedTab=window.demoTabs.find(t=>t.title==='Wikipedia').tab)")
 shot('Reading Space',"gZenWorkspaces.changeWorkspaceWithID(window.demoSpaces.Reading).then(()=>gBrowser.selectedTab=window.demoTabs.find(t=>t.title==='Hacker News').tab)")
 shot('Back to Work',"gZenWorkspaces.changeWorkspaceWithID(window.demoSpaces.Work).then(()=>gBrowser.selectedTab=window.demoTabs.find(t=>t.title==='CSS').tab)")
 shot('Undock the sidebar',"ZenArc.toggleDock()")
 move(700,400);move(1,400);shot('Hover peek')
 move(700,400);shot('Full page with hidden sidebar')
 shot('Dock the sidebar',"ZenArc.toggleDock()")
 shot('Centered command bar',"gURLBar.search('split');")
 shot('Side by side split view',"gURLBar.view.close();gURLBar.blur();document.getElementById('cmd_zenSplitViewVertical').dispatchEvent(new Event('command',{bubbles:true}))",4)
 shot('Unsplit command',"gURLBar.search('unsplit')")
 shot('Return to one page',"gURLBar.view.close();gURLBar.blur();document.getElementById('cmd_zenSplitViewUnsplit').dispatchEvent(new Event('command',{bubbles:true}))")
 shot('Downloads command',"gURLBar.search('downloads')")
 shot('Library downloads',"gURLBar.view.close();gURLBar.blur();document.querySelector('zen-library').activeTab='downloads';ZenArc.setRail(true)",4)
 shot('Library Spaces',"document.querySelector('zen-library').activeTab='spaces'",4)
 shot('Media library',"document.querySelector('zen-library').activeTab='media'",4)
 shot('Return from library',"ZenArc.setRail(false)")
 move(17,870);shot('Downloads hover menu',"ZenArc.openDownloads()",4)
 move(700,400);shot('Download file flight',"ZenArc.hideDownloads();ZenArc.previewDownload({x:1000,y:300})",4)
 shot('Hidden sidebar download',"ZenArc.toggleDock();window.setTimeout(()=>ZenArc.previewDownload({x:1100,y:350}),650)",4.5)
 shot('Dock after download',"ZenArc.toggleDock()")
 shot('Archive command',"gURLBar.search('archive')")
 # Close a real, visited page into native session history, then reveal Archive.
 shot('Archive a background page',"gURLBar.view.close();gURLBar.blur();const t=window.demoTabs.find(t=>t.title==='Zen Browser').tab;gBrowser.removeTab(t,{animate:false});",3.5)
 shot('Archive library',"document.querySelector('zen-library').activeTab='history';Services.prefs.setBoolPref('zen.library.history.closed-tabs',true);ZenArc.setRail(true)",4)
 shot('Restore archived tab',"const row=[...document.querySelectorAll('zen-library .zen-library-row')].find(e=>e.textContent.includes('Zen Browser'));if(row)row.click()",4)
 shot('Close library',"ZenArc.setRail(false)")
 shot('Application menu',"document.getElementById('PanelUI-menu-button').click()")
 shot('Finish on Work',"document.getElementById('appMenu-popup')?.hidePopup();gBrowser.selectedTab=window.demoTabs.find(t=>t.title==='CSS').tab",4)
finally:
 ff.stdin.close();ff.wait();(DEMO/'timeline'/'shots.json').write_text(json.dumps(shots,indent=2));m.delete_session()
print('Recorded',frame/20,'seconds')
