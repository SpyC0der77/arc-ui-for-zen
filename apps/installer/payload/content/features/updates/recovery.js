/* Loaded instead of Zennia when Zen runs a version Zennia has no data for, usually
   after the user chose to update Zen anyway. It leaves Zen's interface alone,
   installs the first Zennia release that supports this version as soon as one
   exists, and offers a restart to turn Zennia back on.
   Kept to long-standing browser APIs, because it runs on untested Zen versions. */
(() => {
  "use strict";
  if (window.ZenniaRecovery || !window.gBrowser) return;
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
  if (PrivateBrowsingUtils.isWindowPrivate(window)) return;
  const { ZenniaUpdater: updater } = ChromeUtils.importESModule("chrome://zennia/content/updater.sys.mjs");
  const scope = {};
  Services.scriptloader.loadSubScript("chrome://zennia/content/shared/toast.js", scope, "UTF-8");
  const toast = scope.ZenniaToast;
  const ID = "paused";
  const NOTIFIED = "zennia.recovery.notified";
  const browserVersion = Services.appinfo.version;
  let shown = null;

  // Zen's automatic updates are Zennia's to hold back only while Zennia runs.
  if (Services.prefs.getStringPref("zennia.browserUpdates.held", "")) {
    const { ZenniaBrowserUpdates } = ChromeUtils.importESModule("chrome://zennia/content/browser-updates.sys.mjs");
    void ZenniaBrowserUpdates.release().catch(error => console.error("[Zennia recovery]", error));
  }

  function message() {
    const tag = updater.release?.tag_name;
    if (["ready", "restarting"].includes(updater.state))
      return { key: "ready " + tag, kind: "success", title: `Zennia supports Zen ${browserVersion}`, description: "Restart Zen to turn it back on.", action: { label: "Restart Zen", run: () => void updater.restart() } };
    if (updater.state === "error")
      return { key: "error " + tag + updater.error, kind: "error", title: "Zennia couldn't update", description: updater.error, action: { label: "Try again", run: () => void updater.download() } };
    // Otherwise say once per Zen version that Zennia is waiting.
    if (Services.prefs.getStringPref(NOTIFIED, "") === browserVersion && shown !== "waiting") return null;
    return { key: "waiting", title: "Zennia is paused", description: `It turns back on by itself once it supports Zen ${browserVersion}.` };
  }

  function render() {
    // A release is installed as soon as it is found; it only takes effect after a restart.
    if (updater.state === "available") void updater.download();
    const next = message();
    if ((next?.key ?? null) === shown) return;
    shown = next?.key ?? null;
    if (!next) { toast.close(window, ID); return; }
    if (next.key === "waiting") Services.prefs.setStringPref(NOTIFIED, browserVersion);
    try { toast.show(window, { id: ID, ...next }); } catch (error) { console.error("[Zennia recovery]", error); }
  }

  // Check once per start, even if a check ran recently: the Zen update makes earlier
  // results stale. Render only after it, so the first message is already right.
  updater.recoveryCheck ??= updater.check({ force: true });
  updater.recoveryCheck.finally(() => {
    if (window.closed) return;
    updater.listeners.add(render);
    render();
  });
  // Later checks are limited to one every six hours across windows.
  const timer = window.setInterval(() => void updater.check(), 60 * 60 * 1000);
  window.ZenniaRecovery = { destroy() { window.clearInterval(timer); updater.listeners.delete(render); toast.close(window, ID); } };
  window.addEventListener("unload", () => window.ZenniaRecovery.destroy(), { once: true });
})();
