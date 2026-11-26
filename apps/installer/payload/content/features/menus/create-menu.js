/* Create-menu labels and commands, plus styles inside native popup shadow roots. */
var ZenniaMenus = {
  install(window, dependencies = {}) {
    const { document, gBrowser } = window;
    const { zen } = dependencies;
    const HTML = "http://www.w3.org/1999/xhtml";
    const cleanups = [];
    const styledPopups = new Set();
    const appMenu = document.getElementById("appMenu-popup");
    const insetAppMenu = () => {
      const rect = appMenu.getBoundingClientRect();
      const screen = window.screen;
      const left = window.mozInnerScreenX + rect.left;
      const top = window.mozInnerScreenY + rect.top;
      const x = Math.max(screen.availLeft + 8,
        Math.min(left, screen.availLeft + screen.availWidth - rect.width - 8));
      const y = Math.max(screen.availTop + 8,
        Math.min(top + 8, screen.availTop + screen.availHeight - rect.height - 8));
      appMenu.moveTo(x, y);
    };
    if (appMenu) {
      appMenu.addEventListener("popupshown", insetAppMenu);
      cleanups.push(() => appMenu.removeEventListener("popupshown", insetAppMenu));
    }
    const createMenu = document.getElementById(zen.name("zenCreateNewPopup"));
    if (createMenu) {
      // Cocoa menus bypass our popup styles. Render this menu in Gecko on all
      // platforms so macOS uses the same custom surface as Windows.
      const originalNative = createMenu.getAttribute("nonnative");
      createMenu.setAttribute("nonnative", "true");
      cleanups.push(() => {
        if (originalNative === null) createMenu.removeAttribute("nonnative");
        else createMenu.setAttribute("nonnative", originalNative);
      });
      const gZenBoostsManager = zen.features.boosts
        ? zen.import("resource:///modules/zen/boosts/ZenBoostsManager.sys.mjs", "gZenBoostsManager")
        : null;
      const items = [
        [zen.name("cmd_zenOpenWorkspaceCreation"), "New Space", "new-space"],
        [zen.name("cmd_zenOpenFolderCreation"), "New Folder", "new-folder"],
        [zen.name("cmd_zenNewEmptySplit"), "New Split", "new-split"],
        ["cmd_newNavigatorTab", "New Tab", "new-tab"],
      ];
      for (const [command, label, image] of items) {
        const item = createMenu.querySelector(`[command="${command}"]`);
        if (!item) continue;
        const originalAttributes = [
          "data-l10n-id",
          "label",
          "image",
          "class",
          "key",
          "disabled",
        ].map((name) => [name, item.getAttribute(name)]);
        cleanups.push(() => {
          for (const [name, value] of originalAttributes) {
            if (value === null) item.removeAttribute(name);
            else item.setAttribute(name, value);
          }
        });
        item.removeAttribute("data-l10n-id");
        item.setAttribute("label", label);
        item.setAttribute(
          "image",
          `chrome://zennia/content/menu-icons/${image}.svg`,
        );
        item.classList.add("menuitem-iconic");
        if (command === "cmd_newNavigatorTab")
          item.setAttribute("key", "key_newNavigatorTab");
      }
      const split = createMenu.querySelector(
        zen.name('[command="cmd_zenNewEmptySplit"]'),
      );
      const tab = createMenu.querySelector('[command="cmd_newNavigatorTab"]');
      if (split) {
        // A command broadcaster would overwrite this item's disabled state.
        split.removeAttribute("command");
        const runSplit = () => {
          if (!split.disabled)
            document.getElementById(zen.name("cmd_zenNewEmptySplit"))?.dispatchEvent(
              new window.Event("command", { bubbles: true }),
            );
        };
        split.addEventListener("command", runSplit);
        cleanups.push(() => {
          split.removeEventListener("command", runSplit);
          split.setAttribute("command", zen.name("cmd_zenNewEmptySplit"));
        });
      }
      const boost = document.createXULElement("menuitem");
      boost.id = "zennia-new-boost";
      boost.classList.add("menuitem-iconic");
      boost.setAttribute("label", "New Boost");
      boost.hidden = !gZenBoostsManager;
      boost.setAttribute(
        "image",
        "chrome://zennia/content/menu-icons/new-boost.svg",
      );
      function createBoost() {
        const uri = gBrowser.currentURI;
        if (!gZenBoostsManager?.canBoostSite(uri)) return;
        const entry = gZenBoostsManager.createNewBoost(uri.host);
        gZenBoostsManager.openBoostWindow(window, entry, uri);
      }
      boost.addEventListener("command", createBoost);
      cleanups.push(() => {
        boost.removeEventListener("command", createBoost);
        boost.remove();
      });
      if (split) createMenu.insertBefore(boost, split);
      if (tab) {
        const separator = document.createXULElement("menuseparator");
        createMenu.insertBefore(separator, tab);
        cleanups.push(() => separator.remove());
      }
      function updateCreateAvailability() {
        const uri = gBrowser.currentURI;
        const hasPage = !!gBrowser.selectedTab && !!uri &&
          !["about:blank", "about:newtab", "about:home"].includes(uri.spec) &&
          !document.getElementById("navigator-toolbox")?.hasAttribute(zen.name("zen-has-empty-tab"));
        boost.disabled = !hasPage || !gZenBoostsManager?.canBoostSite(uri);
        if (split) {
          const command = document.getElementById(zen.name("cmd_zenNewEmptySplit"));
          split.disabled = !hasPage || command?.getAttribute("disabled") === "true";
        }
      }
      createMenu.addEventListener("popupshowing", updateCreateAvailability);
      cleanups.push(() =>
        createMenu.removeEventListener("popupshowing", updateCreateAvailability),
      );
    }
    // Native menu internals have their own stylesheet and override ::part rules.
    // Keep native popup behavior, while theming that internal surface explicitly.
    function styleNativePopup(event) {
      const popup = event.target;
      if (
        !popup.matches?.("panel, menupopup") ||
        !popup.shadowRoot ||
        popup.shadowRoot.querySelector("[data-zennia-menu-style]")
      )
        return;
      const link = document.createElementNS(HTML, "link");
      link.rel = "stylesheet";
      link.href = "chrome://zennia/content/menu-popup.css";
      link.setAttribute("data-zennia-menu-style", "");
      popup.shadowRoot.append(link);
      styledPopups.add(link);
    }
    document.addEventListener("popupshowing", styleNativePopup);

    return {
      destroy() {
        document.removeEventListener("popupshowing", styleNativePopup);
        for (const cleanup of cleanups.reverse()) cleanup();
        for (const link of styledPopups) link.remove();
        styledPopups.clear();
      },
    };
  },
};
