"""Native pointer regressions, attached only to runtime.cjs's disposable session."""
import base64
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'artifacts/test-python'))
from marionette_driver.marionette import Marionette, ActionSequence

port, profile = int(sys.argv[1]), Path(sys.argv[2]).resolve()
if profile.name != 'profile' or not profile.parent.name.startswith('runtime-') or profile.parent.parent != ROOT / 'artifacts':
    raise RuntimeError('Refusing a non-disposable profile')
m = Marionette('127.0.0.1', port=port, socket_timeout=15)
result = {'checks': [], 'errors': []}

def check(condition, label):
    result['checks'].append({'label': label, 'pass': bool(condition)})
    if not condition:
        raise AssertionError(label)

def move(x, y):
    ActionSequence(m, 'pointer', 'runtime-mouse', {'pointerType': 'mouse'}).pointer_move(x, y, origin='viewport').perform()

def click(element):
    ActionSequence(m, 'pointer', 'runtime-mouse', {'pointerType': 'mouse'}).click(element).perform()
    time.sleep(.5)

started = False
validated = False
try:
    m.start_session()
    started = True
    m.set_context('chrome')
    actual = m.execute_script('return Services.dirsvc.get("ProfD", Ci.nsIFile).path')
    if os.path.normcase(str(Path(actual).resolve())) != os.path.normcase(str(profile)):
        raise RuntimeError('Connected browser profile does not match disposable target')
    validated = True
    m.set_window_rect(width=1200, height=800)
    m.execute_script('gURLBar.view.close();gURLBar.blur();gBrowser.selectedBrowser.focus();ZenArc.hideDownloads();void ZenArc.setRail(false);if(ZenArc.diagnostics().compact)ZenArc.toggleDock();')
    time.sleep(.8)
    gift = m.find_element('id', 'arc-gift-button')
    move(700, 400)
    ActionSequence(m, 'pointer', 'runtime-mouse', {'pointerType': 'mouse'}).pointer_move(0, 0, origin=gift).perform()
    time.sleep(.5)
    check(m.execute_script('return ZenArc.diagnostics().popup'), 'native pointer hover opens downloads')
    click(gift)
    time.sleep(.5)
    check(m.execute_script('return ZenArc.diagnostics().rail && !ZenArc.diagnostics().popup'), 'native pointer click opens library and hides downloads')
    legacy = m.execute_script('return !document.querySelector("zen-library")')
    if legacy:
        check(m.execute_script('return ZenArc.diagnostics().archiveHours===null && !ZenArc.debug.available'), 'legacy Archive and debug stay disabled')
        check(m.execute_script('return document.getElementById("arc-gift-button").getAttribute("aria-expanded")==="true"'), 'fallback exposes expanded menu state')
        check(m.execute_script('return ["Downloads","Bookmarks","History"].every(label=>[...document.getElementById("arc-legacy-library").children].some(n=>n.getAttribute("label")===label))'), 'fallback includes native library actions')
        m.execute_script('document.getElementById("arc-legacy-library").hidePopup()')
        # Give the native page a real loaded history entry before closing it.
        count = m.execute_script('return gBrowser.tabs.length')
        m.execute_script('const t=gBrowser.addTab("about:robots",{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()});gBrowser.selectedTab=t;window.arcRecoveryTab=t;')
        time.sleep(1.5)
        m.execute_script('gBrowser.removeTab(window.arcRecoveryTab,{animate:false});delete window.arcRecoveryTab;')
        time.sleep(.8)
        click(gift)
        entries = m.find_elements('css selector', '#arc-legacy-library > menuitem')
        check(len(entries) > 4, 'fallback populates native recently closed entries')
        # The first three entries are library actions; the fourth is the
        # disabled section label. The next entry restores the latest tab.
        click(entries[4])
        time.sleep(.8)
        check(m.execute_script('return gBrowser.tabs.length') == count + 1, 'native recovery entry restores a closed tab')
        check(m.execute_script('return gBrowser.selectedBrowser.currentURI.spec') == 'about:robots', 'restored tab retains its original URL')
    else:
        close = m.find_element('css selector', '[data-l10n-id="library-footer-close-button"]')
        click(close)
    time.sleep(.5)
    check(m.execute_script('return !ZenArc.diagnostics().rail'), 'library closes after native interaction')
except Exception as error:
    result['errors'].append(str(error))
finally:
    if validated:
        try:
            (profile / 'pointer.png').write_bytes(base64.b64decode(m.screenshot()))
        except Exception as error:
            result['screenshotError'] = str(error)
    (profile / 'pointer-results.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    if validated:
        try:
            m.execute_script('Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit)')
        except Exception:
            pass
    if started:
        try:
            m.delete_session()
        except Exception:
            pass
print(json.dumps(result))
if result['errors'] or any(not item['pass'] for item in result['checks']):
    sys.exit(1)
