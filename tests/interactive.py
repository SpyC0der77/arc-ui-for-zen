"""Interactive chrome regression checks. Attach to a Zen launched with --marionette.
Install test dependency with: python -m pip install --target artifacts/test-python marionette_driver
The browser launch needs MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 for this test only.
"""
import base64,json,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'artifacts/test-python'))
from marionette_driver.marionette import Marionette,ActionSequence
m=Marionette('localhost',port=int(sys.argv[1]) if len(sys.argv)>1 else 2828,socket_timeout=20)
m.start_session();m.set_context('chrome')
checks=[]
def state():return m.execute_script('return window.ZenArc.diagnostics()')
def pointer():return ActionSequence(m,'pointer','arc-mouse',{'pointerType':'mouse'})
def click(id):pointer().click(m.find_element('id',id)).perform()
def move(x,y):pointer().pointer_move(x,y,origin='viewport').perform()

def sidebar():return m.execute_script("""const e=document.getElementById('navigator-toolbox');return {right:e.getBoundingClientRect().right,hover:e.hasAttribute('zen-has-hover'),empty:e.hasAttribute('zen-has-empty-tab')}""")
def check(ok,label):
 checks.append({'label':label,'pass':bool(ok)})
 if not ok:raise AssertionError(label)
def close_library():
 pointer().click(m.find_element('css selector','[data-l10n-id="library-footer-close-button"]')).perform();time.sleep(.6)
def dock():
 if state()['compact']:
  move(600,300);move(1,300);time.sleep(.45);click('arc-sidebar-toggle');time.sleep(.6)

def hover_downloads(label):
 pointer().pointer_move(0,0,origin=m.find_element('id','arc-gift-button')).perform();time.sleep(.25)
 visible=m.execute_script("""const p=document.getElementById('arc-download-popup'),r=p.getBoundingClientRect(),native=document.getElementById('zen-library-download-list');return {custom:p.dataset.arcDownloadDesign==='arc'&&p.matches(':popover-open')&&p.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),nativeHidden:!native||getComputedStyle(native).display==='none',x:r.x+r.width/2,y:r.bottom-16};""")
 check(state()['popup'] and visible['custom'] and visible['nativeHidden'],f'only Arc popup paints on hover {label}')
 move(visible['x'],visible['y']);time.sleep(.5)
 check(state()['popup'],f'popup remains open after pointer enters its content {label}')
 if state()['compact']:check(sidebar()['right']>200,f'popup hover keeps undocked sidebar visible {label}')
 if label=='docked 1':(ROOT/'artifacts/interactive-download-empty.png').write_bytes(base64.b64decode(m.screenshot()))
 pointer().pointer_move(0,0,origin=m.find_element('id','arc-gift-button')).perform()
try:
 if state()['rail']:close_library()
 dock()
 for cycle in range(3):
  move(600,300)
  hover_downloads(f'docked {cycle+1}')
  click('arc-gift-button');time.sleep(.7)
  check(state()['rail'] and not state()['popup'],f'trusted gift click opens library {cycle+1}')
  if cycle==0:(ROOT/'artifacts/interactive-library.png').write_bytes(base64.b64decode(m.screenshot()))
  close_library();check(not state()['rail'],f'library back closes {cycle+1}')
  m.execute_script("""window.arcMotionFrames=[];window.arcMotionImage=null;
  document.getElementById('arc-sidebar-toggle').addEventListener('pointerdown',()=>{
   const start=performance.now();function tick(){const e=document.getElementById('navigator-toolbox'),g=document.getElementById('arc-sidebar-transition');arcMotionFrames.push({t:performance.now()-start,right:e.getBoundingClientRect().right,visible:getComputedStyle(e).visibility,childVisible:[...e.querySelectorAll('*')].some(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(n).visibility==='visible'}),hover:e.hasAttribute('zen-has-hover'),ghost:!!g});if(performance.now()-start<650)requestAnimationFrame(tick)}tick();
   setTimeout(async()=>{const snap=await browsingContext.currentWindowGlobal.drawSnapshot(new DOMRect(0,0,innerWidth,innerHeight),1,'white');const c=document.createElementNS('http://www.w3.org/1999/xhtml','canvas');c.width=innerWidth;c.height=innerHeight;c.getContext('2d').drawImage(snap,0,0);snap.close();window.arcMotionImage=c.toDataURL('image/png').split(',')[1]},110)
  },{once:true});""")
  click('arc-sidebar-toggle');time.sleep(.75)
  frames=m.execute_script('return arcMotionFrames')
  check(state()['compact'],f'pointer click hides sidebar {cycle+1}')
  check(any(f['ghost'] for f in frames),f'closing animation runs {cycle+1}')
  check(not any(f['ghost'] and f['visible']=='visible' and f['right']>1 for f in frames),f'no live sidebar behind closing layer {cycle+1}')
  check(not any(f['ghost'] and f['childVisible'] for f in frames),f'no independently visible children behind closing layer {cycle+1}')
  check(m.execute_script("return document.getElementById('navigator-toolbox').getBoundingClientRect().right<=10"),f'sidebar stays hidden with pointer at toggle {cycle+1}')
  # A human hand moves after clicking, including across the reveal strip.
  # Stay there longer than Zen's native 500ms ignore-hover timeout.
  for x,y in [(32,24),(25,25),(6,25),(1,25),(3,26)]:
   move(x,y);time.sleep(.15)
  time.sleep(.6)
  check(state()['sidebarHoverBlocked'] and not sidebar()['hover'] and sidebar()['right']<=10,f'edge jitter cannot reopen dismissed sidebar {cycle+1}')
  if cycle==0:
   image=m.execute_script('return arcMotionImage')
   (ROOT/'artifacts/interactive-closing.png').write_bytes(base64.b64decode(image))
   (ROOT/'artifacts/interactive-hidden.png').write_bytes(base64.b64decode(m.screenshot()))
  # Exercise library from compact-mode hover peek too.
  move(600,300);check(not state()['sidebarHoverBlocked'],f'leaving former sidebar rearms edge hover {cycle+1}')
  move(1,300);time.sleep(.45)
  check(sidebar()['hover'] and sidebar()['right']>200,f'deliberate edge return shows one sidebar {cycle+1}')
  surface=m.execute_script("""const c=getComputedStyle(document.getElementById('zen-toolbar-background')),p=getComputedStyle(document.querySelector('.browserSidebarContainer:not(.zen-glance-overlay)'));return {shadow:c.boxShadow,radius:c.borderRadius,pageRadius:p.borderRadius}""")
  check(surface['shadow']!='none' and surface['radius']=='12px' and surface['pageRadius']=='10px',f'peek floats over rounded content {cycle+1}')
  hover_downloads(f'undocked {cycle+1}')
  click('arc-gift-button');time.sleep(.7)
  check(state()['rail'],f'gift click opens library from hover peek {cycle+1}')
  close_library();dock()
 # Escape must stay closed even when returning keyboard focus to the trigger.
 move(600,300);hover_downloads('before Escape')
 from marionette_driver.keys import Keys
 ActionSequence(m,'key','arc-keyboard').key_down(Keys.ESCAPE).key_up(Keys.ESCAPE).perform();time.sleep(.3)
 check(not state()['popup'],'Escape closes popup without focus reopening it')
 print(json.dumps({'checks':checks,'final':state()},indent=2))
 (ROOT/'artifacts/interactive-results.json').write_text(json.dumps(checks,indent=2))
finally:
 m.delete_session()

