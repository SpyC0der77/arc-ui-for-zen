"""Inspect native sidebar layers in a test Zen launched with --marionette.

Use the dependency and launch setup described in interactive.py. This pauses
the actual chrome animations, records their corner geometry and hit targets,
and saves screenshots in artifacts/sidebar-motion.
"""
import base64
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'artifacts/test-python'))
from marionette_driver.marionette import Marionette, ActionSequence

m = Marionette('localhost', port=2828, socket_timeout=30)
m.start_session()
m.set_context('chrome')
out = ROOT / 'artifacts/sidebar-motion'
out.mkdir(exist_ok=True)
parts = ['arc-top-controls', 'nav-bar', 'TabsToolbar']

def script(code, *args):
    return m.execute_script(code, script_args=list(args))

def move(x, y):
    ActionSequence(m, 'pointer', 'sidebar-motion', {'pointerType': 'mouse'}).pointer_move(x, y, origin='viewport').perform()

def screenshot(name):
    (out / (name + '.png')).write_bytes(base64.b64decode(m.screenshot()))

try:
    move(650, 300)
    if script('return ZenArc.diagnostics().compact'):
        script('ZenArc.toggleDock()')
        time.sleep(.4)
    script('ZenArc.toggleDock()')
    time.sleep(.7)  # Zen's intentional ignore-hover interval lasts 500ms.
    move(650, 300)
    move(1, 300)
    time.sleep(.5)
    baseline = script("return Object.fromEntries(arguments[0].map(id=>[id,document.getElementById(id).getBoundingClientRect().toJSON()]))", parts)
    assert baseline['nav-bar']['x'] > 0, 'The test must start from a visible hover peek.'
    screenshot('peek')
    # Include the reparented toolbar parts in the same paused clock.
    script("""
      window.arcTestAnimate=Element.prototype.animate;
      Element.prototype.animate=function(...args) {
        const a=arcTestAnimate.apply(this,args);
        if(['navigator-toolbox','zen-tabbox-wrapper','arc-sidebar-surface','arc-top-controls','nav-bar','TabsToolbar'].includes(this.id)) {
          a.pause();a.currentTime=0;
        }
        return a;
      };
      ZenArc.toggleDock();
    """)
    time.sleep(.15)
    frames = []
    for progress in [0, .25, .5, .75, .95]:
        script("for(const a of document.getAnimations())if(a.playState==='paused')a.currentTime=a.effect.getTiming().duration*arguments[0]", progress)
        frame = script("""
          const toolbox=document.getElementById('navigator-toolbox'),surface=document.getElementById('arc-sidebar-surface');
          const r=surface.getBoundingClientRect(),s=getComputedStyle(surface);
          return {radius:parseFloat(s.borderRadius),rect:r.toJSON(),clip:getComputedStyle(toolbox).clipPath,
            transition:getComputedStyle(toolbox).transitionDuration,
            paint:['navigator-toolbox','titlebar'].map(id=>getComputedStyle(document.getElementById(id)).backgroundColor),
            cornerHitsSidebar:document.elementsFromPoint(r.right-1,r.top+1).some(e=>toolbox.contains(e)),
            parts:Object.fromEntries(arguments[0].map(id=>[id,document.getElementById(id).getBoundingClientRect().toJSON()]))};
        """, parts)
        frames.append(frame)
        screenshot('dock-' + str(int(progress * 100)))
    checks = {
        'native square layers stay transparent': all(c == 'rgba(0, 0, 0, 0)' for f in frames for c in f['paint']),
        'hover transition stays disabled': all(f['transition'] == '0s' for f in frames),
        'rounded corner excludes native sidebar': not frames[0]['cornerHitsSidebar'],
        'radius closes continuously': frames[0]['radius'] == 12 and all(a['radius'] > b['radius'] for a, b in zip(frames, frames[1:])),
        'controls keep their initial bounds': all(abs(frames[0]['parts'][id][axis] - rect[axis]) < 1 for id, rect in baseline.items() for axis in ['x', 'y', 'width', 'height']),
    }
    (out / 'frames.json').write_text(json.dumps({'baseline': baseline, 'frames': frames, 'checks': checks}, indent=2))
    print(json.dumps(checks, indent=2))
    assert all(checks.values()), checks
finally:
    script('if(window.arcTestAnimate)Element.prototype.animate=arcTestAnimate;for(const a of document.getAnimations())if(a.playState==="paused")a.finish()')
    time.sleep(.1)
    assert script("return !document.getElementById('arc-sidebar-surface')&&!document.documentElement.hasAttribute('data-arc-sidebar-animating')"), 'Transition did not clean up.'
    m.delete_session()
