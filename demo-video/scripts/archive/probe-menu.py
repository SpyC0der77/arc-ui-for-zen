import sys,time,base64
from pathlib import Path
sys.path.insert(0,'artifacts/test-python')
from marionette_driver.marionette import Marionette,ActionSequence
m=Marionette('localhost',port=2828);m.start_session();m.set_context('chrome')
m.execute_script('PanelUI.show();');time.sleep(.5);print(m.execute_script('return {state:document.getElementById("appMenu-popup").state,rect:document.getElementById("appMenu-popup").getBoundingClientRect().toJSON()}'))
try:Path('artifacts/product-demo/menu.png').write_bytes(base64.b64decode(m.screenshot(element=m.find_element('id','appMenu-popup'))))
except Exception as e:print(e)
m.execute_script('PanelUI.hide()');m.delete_session()
