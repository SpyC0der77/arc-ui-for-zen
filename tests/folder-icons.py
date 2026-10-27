"""Compare browser-painted folder glyphs before and after open/close clicks.

Marionette repaints the browser for screenshots. This check cannot detect
compositor-only clipping; also inspect native window captures after closing.

Attach only to an explicitly launched disposable Zen session with --marionette
and MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1, as described in interactive.py.
Usage: python tests/folder-icons.py [port]
Requires Pillow and artifacts/test-python's marionette_driver.
"""
import base64
import io
import sys
import time
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'artifacts/test-python'))
from marionette_driver.marionette import Marionette, ActionSequence

m = Marionette('localhost', port=int(sys.argv[1]) if len(sys.argv) > 1 else 2828,
               socket_timeout=20)
m.start_session()
m.set_context('chrome')


def script(code, *args):
    return m.execute_script(code, script_args=list(args))


def move(x, y):
    ActionSequence(m, 'pointer', 'folder-icon', {'pointerType': 'mouse'}).pointer_move(
        x, y, origin='viewport').perform()


def capture():
    bounds = script("""
      const r=document.querySelector('zen-folder svg').getBoundingClientRect();
      return [r.x,r.y,r.right,r.bottom];
    """)
    image = Image.open(io.BytesIO(base64.b64decode(m.screenshot()))).convert('RGB')
    # Marionette chrome screenshots use CSS pixels. Match the same raster crop
    # before and after the transition, including fractional layout origins.
    return image.crop(tuple(round(v) for v in bounds))


try:
    for _ in range(50):
        if script("return !!window.ZenArc && !!document.querySelector('zen-folder .icon image') && !document.documentElement.hasAttribute('data-arc-sidebar-animating');"):
            break
        time.sleep(.1)
    # Let the native workspace restore finish before changing compact mode.
    time.sleep(1)
    assert script("return !!document.querySelector('zen-folder .icon image');"), 'A custom folder icon is required'
    # Start from the docked raster, which remains correct even when the
    # floating SVG-filter surface has already cached a clipped image.
    if script('return gZenCompactModeManager.preference;'):
        script('ZenArc.toggleDock();')
        time.sleep(.6)
    script("const f=document.querySelector('zen-folder');f.collapsed=true;gZenFolders.updateFolderIcon(f);")
    time.sleep(.5)
    rect = script("const r=document.querySelector('zen-folder .tab-group-label').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];")
    move(*rect)
    before = capture()
    script('ZenArc.toggleDock();')
    time.sleep(.6)
    move(600, 300)
    move(1, 300)
    time.sleep(.4)
    rect = script("const r=document.querySelector('zen-folder .tab-group-label').getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2];")
    move(*rect)
    script("const f=document.querySelector('zen-folder');f.collapsed=true;gZenFolders.updateFolderIcon(f);")
    time.sleep(.5)
    for _ in range(3):
        label = m.find_element('css selector', 'zen-folder .tab-group-label')
        label.click()
        time.sleep(.4)
        label.click()
        time.sleep(.5)
        after = capture()
        assert ImageChops.difference(before, after).getbbox() is None, 'Floating closed glyph differs from docked raster after animation'
    out = ROOT / 'artifacts/folder-icons'
    out.mkdir(exist_ok=True)
    before.save(out / 'before.png')
    after.save(out / 'after.png')
    print('PASS: browser-painted floating glyph matches docked pixels after three cycles; native compositor capture still required')
finally:
    m.delete_session()
