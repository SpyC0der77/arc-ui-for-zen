/* Connect idle-tab archiving to Zen tabs, preferences, and native library history. */
var ArcAutoArchive = {
  install(window, dependencies = {}) {
    const { document, gBrowser } = window;
    const { Services, PrivateBrowsingUtils, createMotion } = dependencies;
    // Older Zen has no persistent Archive. Do not close idle tabs into its
    // bounded undo history and imply they have the newer Archive's retention.
    if (!document.querySelector("zen-library"))
      return { hours: () => null, destroy() {} };
    const motion = createMotion(window);
    const { later, clear, animate } = motion;
    let archiveAPI = null,
      stopArchive = () => {};
    function archiveTabInfo(tab) {
      return {
        tab,
        closed: tab.closed,
        pinned: tab.pinned,
        essential: tab.hasAttribute("zen-essential"),
        selected: tab.selected,
        multiselected: tab.hasAttribute("multiselected"),
        splitview: !!tab.splitview,
        grouped: !!tab.group,
        folded: !!tab.closest("zen-folder"),
        audible: tab.audible || tab.hasAttribute("soundplaying"),
        busy: tab.hasAttribute("busy"),
        attention: tab.hasAttribute("attention"),
        url: tab.linkedBrowser?.currentURI?.spec || "",
        lastAccessed: tab.lastAccessed,
      };
    }
    // Zen keeps the table for the library's Archive tab; reuse it instead of a second store.
    function announceArchive(count) {
      const container = document.getElementById("zen-toast-container");
      if (!container) return;
      const toast = document.createXULElement("hbox");
      toast.className = "zen-toast";
      const box = document.createXULElement("vbox"),
        label = document.createXULElement("label");
      label.textContent =
        count === 1 ? "1 idle tab archived" : `${count} idle tabs archived`;
      box.append(label);
      toast.append(box);
      container.removeAttribute("hidden");
      container.append(toast);
      void animate(
        toast,
        [
          { opacity: 0, transform: "scale(.9)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 180, easing: "ease-out" },
      );
      later(() => {
        void animate(toast, [{ opacity: 1 }, { opacity: 0 }], {
          duration: 160,
          easing: "ease-in",
        }).then(() => {
          toast.remove();
          if (!container.children.length)
            container.setAttribute("hidden", "true");
        });
      }, 2400);
    }
    if (!PrivateBrowsingUtils.isWindowPrivate(window)) {
      try {
        const archive = {};
        Services.scriptloader.loadSubScript(
          "chrome://arc-ui/content/archive.js",
          archive,
          "UTF-8",
        );
        archiveAPI = archive.ArcArchive;
        // Show the Archive view by default once; switching the library back to
        // History is the user's choice and survives the next start.
        if (!Services.prefs.getBoolPref("arc-ui.archive-initialized", false)) {
          Services.prefs.setBoolPref("zen.library.history.closed-tabs", true);
          Services.prefs.setBoolPref("arc-ui.archive-initialized", true);
        }
        stopArchive = archiveAPI.start({
          getHours: () => archiveAPI.hours(Services.prefs),
          tabs: () =>
            gBrowser.tabContainer.hasAttribute("movingtab")
              ? []
              : [...gBrowser.tabs].map(archiveTabInfo),
          close: (row) => gBrowser.removeTab(row.tab, { animate: false }),
          announce: announceArchive,
          isClosed: () => window.closed,
          schedule: later,
          cancel: clear,
          onError: (error) =>
            window.console.error("[Arc UI] Auto-Archive failed", error),
        });
      } catch (error) {
        window.console.error("[Arc UI] Auto-Archive unavailable", error);
      }
    }

    return {
      hours: () => (archiveAPI ? archiveAPI.hours(Services.prefs) : null),
      destroy() {
        stopArchive();
        motion.destroy();
      },
    };
  },
};
