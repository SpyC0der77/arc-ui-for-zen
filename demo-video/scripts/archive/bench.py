import sys,time,base64
from pathlib import Path
sys.path.insert(0,'artifacts/test-python')
from marionette_driver.marionette import Marionette
m=Marionette('localhost',port=2828);m.start_session();m.set_context('chrome');t=time.monotonic()
for i in range(10): b=m.screenshot()
print('seconds',time.monotonic()-t);Path('artifacts/product-demo/actual.png').write_bytes(base64.b64decode(b));m.delete_session()
