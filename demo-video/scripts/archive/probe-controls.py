import sys,json
sys.path.insert(0,'artifacts/test-python')
from marionette_driver.marionette import Marionette
m=Marionette('localhost',port=2828);m.start_session();m.set_context('chrome');print(m.execute_script('return {folder:document.querySelector(\'zen-folder[label="Web development"]\').outerHTML.slice(0,2800),panel:document.getElementById("PanelUI-menu-button").outerHTML,splitters:[...document.querySelectorAll("splitter")].map(e=>({id:e.id,rect:e.getBoundingClientRect().toJSON()}))}'));m.delete_session()
