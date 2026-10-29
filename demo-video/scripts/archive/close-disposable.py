import sys,time,json
from pathlib import Path
sys.path.insert(0,'artifacts/test-python')
from marionette_driver.marionette import Marionette
m=Marionette('localhost',port=2828);m.start_session();m.set_context('chrome')
print(m.execute_script('return {profile:Services.dirsvc.get("ProfD",Ci.nsIFile).path,spaces:gZenWorkspaces.getWorkspaces().map(s=>s.name),debug:ZenArc.diagnostics().debug}'))
m.execute_script('Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit)')
