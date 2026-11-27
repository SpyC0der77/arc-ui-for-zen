/* Chooses what Zennia loads into each browser window.
   Zennia changes Zen only on versions it was tested with: each one has a data file
   in zen-versions/. When Zen updates itself to any other version, Zennia stays
   paused and loads recovery instead, which explains that and offers a Zennia
   release that supports the new version. */
(() => {
  "use strict";
  const version = Services.appinfo.version;
  let supported = false;
  if (/^\d+\.\d+(?:\.\d+)?[a-z]?$/.test(version)) {
    const data = Services.dirsvc.get("ProfD", Ci.nsIFile);
    for (const part of ["chrome", "zennia", "zen-versions", version + ".json"]) data.append(part);
    supported = data.exists();
  }
  Services.scriptloader.loadSubScript(
    supported ? "chrome://zennia-runtime/content/zennia.uc.js" : "chrome://zennia/content/features/updates/recovery.js",
    window,
    "UTF-8",
  );
})();
