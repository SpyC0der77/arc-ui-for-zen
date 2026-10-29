import sys,json,time,base64,ctypes
from pathlib import Path
sys.path.insert(0,'artifacts/test-python')
from marionette_driver.marionette import Marionette
m=Marionette('localhost',port=2828);m.start_session();m.set_context('chrome')
m.execute_script("Services.prefs.setCharPref('layout.css.devPixelsPerPx','1.0')")
m.set_window_rect(x=0,y=0,width=1608,height=904)
time.sleep(1)
print(m.execute_script('return {size:[innerWidth,innerHeight,devicePixelRatio],spaces:gZenWorkspaces.getWorkspaces(),state:ZenArc.diagnostics()}'))
Path('artifacts/product-demo/probe.png').write_bytes(base64.b64decode(m.screenshot()))
m.delete_session()
