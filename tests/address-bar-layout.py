"""Attach only to a disposable Marionette session, as described in AGENTS.md."""
import sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'artifacts/test-python'))
from marionette_driver.marionette import Marionette
m=Marionette('localhost',port=int(sys.argv[1]) if len(sys.argv)>1 else 2828,socket_timeout=25)
m.start_session();m.set_context('chrome')
def geometry():
 return m.execute_script("const a=document.getElementById('arc-top-controls').getBoundingClientRect(),b=document.getElementById('urlbar-container').getBoundingClientRect();return {gap:b.top-a.bottom,height:b.height}")
try:
 m.execute_script('gURLBar.view.close();gURLBar.blur()');time.sleep(.3)
 closed=geometry()
 m.execute_async_script("const done=arguments[arguments.length-1];(async()=>{gURLBar.search('archive');await gURLBar.lastQueryContextPromise;done(true)})()");time.sleep(.3)
 opened=geometry()
 assert opened['gap']>=6,(closed,opened)
 assert abs(opened['height']-closed['height'])<.5,(closed,opened)
 print('PASS: opening the command bar retains address-field height and navigation spacing',closed,opened)
finally:
 m.execute_script('gURLBar.view.close();gURLBar.blur()');m.delete_session()
