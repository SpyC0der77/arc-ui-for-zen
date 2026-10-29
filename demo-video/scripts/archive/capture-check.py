import sys,time,base64,json,ctypes,subprocess
from pathlib import Path
sys.path.insert(0,'artifacts/test-python')
from marionette_driver.marionette import Marionette,ActionSequence
m=Marionette('localhost',port=2828,socket_timeout=60);m.start_session();m.set_context('chrome')
icons={n:Path('artifacts/product-demo/'+f+'.svg').resolve().as_uri() for n,f in [('Work','briefcase-business'),('Personal','house'),('Reading','book-open')]}
m.execute_script('for(const s of gZenWorkspaces.getWorkspaces()){s.icon=arguments[0][s.name];gZenWorkspaces.saveWorkspace(s)};gZenWorkspaces.changeWorkspaceWithID(window.demoSpaces.Work);const style=document.createElementNS("http://www.w3.org/1999/xhtml","style");style.textContent="#remote-control-box{display:none!important}";document.documentElement.append(style)',script_args=[icons]);time.sleep(1)
ctypes.windll.user32.SetWindowPos(34082536,-1,0,0,1608,904,0x0040)
ctypes.windll.user32.SetForegroundWindow(34082536)
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','gdigrab','-draw_mouse','0','-offset_x','8','-offset_y','0','-video_size','1592x896','-i','desktop','-frames:v','1','artifacts/product-demo/desktop-test.png'])
print(m.execute_script('return {space:gZenWorkspaces.getWorkspaces().map(s=>s.name), tabs:gBrowser.visibleTabs.map(t=>t.label),els:[...document.querySelectorAll("zen-library [data-l10n-id]")].slice(0,12).map(e=>e.getAttribute("data-l10n-id"))}'))
m.delete_session()
