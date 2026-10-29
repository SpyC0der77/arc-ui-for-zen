/* Arc UI for supported Zen releases. Startup wiring only; UI changes live in content/features/. */
(() => {
  "use strict";
  if (window.ZenArc || !window.gBrowser) return;

  const { Downloads } = ChromeUtils.importESModule(
    "resource://gre/modules/Downloads.sys.mjs",
  );
  const { PrivateBrowsingUtils } = ChromeUtils.importESModule(
    "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  );
  const root = document.documentElement;
  if (
    !document.getElementById("navigator-toolbox") ||
    !document.getElementById("zen-tabbox-wrapper") ||
    !window.gZenCompactModeManager
  ) {
    throw new Error("Unsupported Zen window layout");
  }

  window.windowUtils.loadSheetUsingURIString(
    "chrome://arc-ui-runtime/content/arc.css",
    window.windowUtils.USER_SHEET,
  );
  root.setAttribute("data-arc-ui", "0.1.0");

  // Each subscript gets a separate scope. Pass browser objects explicitly so
  // feature state stays local to this window, including private windows.
  function load(path, name) {
    const scope = {};
    Services.scriptloader.loadSubScript(
      `chrome://arc-ui/content/${path}.js`,
      scope,
      "UTF-8",
    );
    return scope[name];
  }
  const cleanups = [];
  function install(path, name, dependencies = {}) {
    const feature = load(path, name).install(window, dependencies);
    cleanups.push(() => feature.destroy());
    return feature;
  }

  const createMotion = (browserWindow) =>
    load("shared/motion", "ArcMotion").install(browserWindow);
  const ui = install("shared/ui", "ArcUI", { createMotion });
  const { el, icon, nudge, button, downloadButton } = ui;
  const status = el("div", {
    id: "arc-live-status",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  document.body.append(status);
  function report(error) {
    console.error("[Arc UI]", error);
    status.textContent = error.message || String(error);
  }

  install("features/menus/create-menu", "ArcMenus");
  install("features/sidebar/width", "ArcSidebarWidth", { Services });
  const address = install(
    "features/address-bar/address-label",
    "ArcAddressLabel",
    { el },
  );

  // These callbacks are invoked by user events after startup has finished.
  // The library owns the shared trigger; downloads owns its hover popup.
  let sidebar, downloads;
  const navigation = install("features/navigation/controls", "ArcNavigation", {
    el,
    icon,
    button,
    rememberAddress: address.rememberAddress,
    toggleDock: () => sidebar.toggleDock(),
  });
  const library = install("features/library/library", "ArcLibrary", {
    icon,
    nudge,
    report,
    hideDownloads: () => downloads.hideDownloads(),
  });
  downloads = install("features/downloads/downloads", "ArcDownloads", {
    Services,
    Downloads,
    PrivateBrowsingUtils,
    PathUtils,
    el,
    icon,
    nudge,
    downloadButton,
    createMotion,
    status,
    report,
    createRows: load("features/downloads/rows", "ArcDownloadRows").install,
    gift: library.gift,
    isLibraryOpen: library.isOpen,
  });
  sidebar = install("features/sidebar/compact-mode", "ArcCompactSidebar", {
    el,
    createMotion,
    hideDownloads: downloads.hideDownloads,
    updateNav: navigation.updateNav,
  });

  // Keep the public interface stable for commands, debug mode, and runtime tests.
  let archive;
  window.ZenArc = {
    version: "0.1.0",
    previewDownload: downloads.flight,
    toggleDock: sidebar.toggleDock,
    setRail: library.setRail,
    openDownloads: downloads.openDownloads,
    hideDownloads: downloads.hideDownloads,
    diagnostics: () => ({
      version: "0.1.0",
      browser: Services.appinfo.version,
      compact: window.gZenCompactModeManager.preference,
      sidebarHoverBlocked: sidebar.isHoverBlocked(),
      ...downloads.diagnostics(),
      debug: !!window.ZenArc.debug?.enabled,
      private: PrivateBrowsingUtils.isWindowPrivate(window),
      rail: library.isOpen(),
      archiveHours: archive ? archive.hours() : null,
    }),
  };
  navigation.updateNav();
  downloads.renderDownloads();
  archive = install("features/archive/auto-archive", "ArcAutoArchive", {
    Services,
    PrivateBrowsingUtils,
    createMotion,
  });

  // These existing modules already own their behavior and return cleanup.
  const stopNativeActions = load("native-actions", "ArcNativeActions").install({
    document,
    contextTabs: () => {
      const tab = window.TabContextMenu.contextTab;
      return tab?.multiselected ? [...gBrowser.selectedTabs] : [tab];
    },
  });
  cleanups.push(stopNativeActions);
  cleanups.push(load("split-actions", "ArcSplitActions").install(window));
  try {
    const debug = ChromeUtils.importESModule(
      "chrome://arc-ui/content/debug.sys.mjs",
    );
    const { html } = ChromeUtils.importESModule(
      "chrome://global/content/vendor/lit.all.mjs",
      { global: "current" },
    );
    window.ZenArc.debug = debug.install(window, {
      html,
      isPrivate: PrivateBrowsingUtils.isWindowPrivate(window),
      setDownloads: downloads.setDebugDownloads,
      announce: (message) => {
        status.textContent = message;
      },
    });
    cleanups.push(() => window.ZenArc.debug.destroy());
  } catch (error) {
    console.error("[Arc UI] Debug mode unavailable", error);
  }
  try {
    const commands = ChromeUtils.importESModule(
      "chrome://arc-ui/content/commands.sys.mjs",
    );
    cleanups.push(commands.install(window));
  } catch (error) {
    console.error("[Arc UI] Command bar actions unavailable", error);
  }
  install("features/github/live-folders", "ArcGitHubFolders", {
    Services,
    PrivateBrowsingUtils,
    createMotion,
  });
  install("features/onboarding/demo", "ArcDemo", {
    Services,
    PrivateBrowsingUtils,
    createMotion,
  });

  window.addEventListener(
    "unload",
    () => {
      // Consumers stop before the controls and helpers they use.
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          console.error("[Arc UI] Cleanup failed", error);
        }
      }
      status.remove();
    },
    { once: true },
  );
})();
