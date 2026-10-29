"""Window-isolation regression. Attach only to a disposable Marionette session."""
import json, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'artifacts/test-python'))
from marionette_driver.marionette import Marionette
m = Marionette('localhost', port=int(sys.argv[1]) if len(sys.argv) > 1 else 2828, socket_timeout=30)
m.start_session()
m.set_context('chrome')
original = m.current_chrome_window_handle
checks = []
def check(condition, label):
    checks.append({'label': label, 'pass': bool(condition)})
    if not condition:
        raise AssertionError(label)
def ready():
    for _ in range(100):
        if m.execute_script('return !!window.ZenArc'):
            return
        time.sleep(.1)
    raise AssertionError('new window did not initialize')
def diagnostics():
    return m.execute_script('return window.ZenArc.diagnostics()')
try:
    initial = diagnostics()['realDownloads']
    handles = set(m.chrome_window_handles)
    m.execute_script('OpenBrowserWindow({private:true})')
    for _ in range(100):
        new = set(m.chrome_window_handles) - handles
        if new:
            break
        time.sleep(.1)
    private = new.pop()
    m.switch_to_window(private)
    ready()
    state = diagnostics()
    check(state['private'] and state['archiveHours'] is None, 'private window initializes without auto-archive')
    private_count = state['realDownloads']
    m.switch_to_window(original)
    m.execute_async_script("""
      const done = arguments[arguments.length - 1];
      (async () => {
        const {Downloads} = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
        const download = await Downloads.createDownload({source:'https://example.invalid/refactor-check',target:PathUtils.join(PathUtils.tempDir,'arc-refactor-window-check.txt')});
        window.arcWindowTestDownload = download;
        await (await Downloads.getList(Downloads.PUBLIC)).add(download);
        done(true);
      })().catch(error => done(String(error)));
    """)
    time.sleep(2)
    check(diagnostics()['realDownloads'] == initial + 1, 'public window observes the public download list')
    m.switch_to_window(private)
    check(diagnostics()['realDownloads'] == private_count, 'public download does not leak into private window')
    m.execute_script('window.close()')
    m.switch_to_window(original)
    time.sleep(2)
    m.execute_script('window.ZenArc.openDownloads()')
    check(diagnostics()['popup'], 'closing private window leaves public download controls working')
    m.execute_script('window.ZenArc.hideDownloads()')
    handles = set(m.chrome_window_handles)
    m.execute_script('OpenBrowserWindow()')
    for _ in range(100):
        new = set(m.chrome_window_handles) - handles
        if new:
            break
        time.sleep(.1)
    second = new.pop()
    m.switch_to_window(second)
    ready()
    check(not diagnostics()['private'], 'second ordinary window initializes independently')
    m.execute_script('window.close()')
    m.switch_to_window(original)
    time.sleep(2)
    m.execute_script('window.ZenArc.openDownloads()')
    check(diagnostics()['popup'], 'closing second window leaves first window working')
    m.execute_script('window.ZenArc.hideDownloads()')
    print(json.dumps(checks, indent=2))
    (ROOT / 'artifacts/refactor-window-results.json').write_text(json.dumps(checks, indent=2))
finally:
    m.switch_to_window(original)
    m.execute_async_script("""
      const done = arguments[arguments.length - 1];
      (async () => {
        if (window.arcWindowTestDownload) {
          const {Downloads} = ChromeUtils.importESModule('resource://gre/modules/Downloads.sys.mjs');
          await (await Downloads.getList(Downloads.PUBLIC)).remove(window.arcWindowTestDownload);
          delete window.arcWindowTestDownload;
        }
        window.ZenArc.hideDownloads(); done(true);
      })().catch(error => done(String(error)));
    """)
    m.delete_session()

