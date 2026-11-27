/* Tells the user when Zennia holds back a Zen update it does not support yet, and
   lets them update Zen anyway. The hold itself lives in browser-updates.sys.mjs. */
var ZenniaBrowserUpdateNotice = {
  install(window, { PrivateBrowsingUtils }) {
    const { ZenniaBrowserUpdates: guard } = window.ChromeUtils.importESModule('chrome://zennia/content/browser-updates.sys.mjs');
    guard.start();
    if (PrivateBrowsingUtils.isWindowPrivate(window)) return { destroy() {} };
    const Services = window.Services, ID = 'browser-update', NOTIFIED = 'zennia.browserUpdates.notified';
    const scope = {};
    Services.scriptloader.loadSubScript('chrome://zennia/content/shared/toast.js', scope, 'UTF-8');
    const toast = scope.ZenniaToast;
    let shown = null;
    function message() {
      if (guard.allowed) return { key: 'allowed ' + guard.allowed, title: `Zen is updating to ${guard.allowed}`, description: 'Zennia pauses until it supports that version, then turns back on.' };
      if (!guard.held) return null;
      // Each held version is announced once; Zen's own update controls still work.
      if (Services.prefs.getStringPref(NOTIFIED, '') === guard.held && shown !== 'held ' + guard.held) return null;
      return { key: 'held ' + guard.held, title: 'Zen update on hold', description: `Zen ${guard.held} is out, but Zennia doesn't support it yet.`, action: { label: 'Update anyway', run: () => void guard.allow() } };
    }
    function render() {
      const next = message();
      if ((next?.key ?? null) === shown) return;
      shown = next?.key ?? null;
      if (!next) { toast.close(window, ID); return; }
      if (guard.held) Services.prefs.setStringPref(NOTIFIED, guard.held);
      toast.show(window, { id: ID, ...next });
    }
    guard.listeners.add(render);
    render();
    return { destroy() { guard.listeners.delete(render); toast.close(window, ID); } };
  },
};
