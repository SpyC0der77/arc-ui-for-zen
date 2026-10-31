/* Create-menu labels and commands, plus styles inside native popup shadow roots. */
var ArcMenus = {
  install(window, dependencies = {}) {
    const { document, gBrowser, ChromeUtils } = window;
    const HTML = "http://www.w3.org/1999/xhtml";
    const cleanups = [];
    const styledPopups = new Set();
    const createMenu = document.getElementById("zenCreateNewPopup");
    if (createMenu) {
      // Cocoa menus bypass our popup styles. Render this menu in Gecko on all
      // platforms so macOS uses the same custom surface as Windows.
      const originalNative = createMenu.getAttribute("nonnative");
      createMenu.setAttribute("nonnative", "true");
      cleanups.push(() => {
        if (originalNative === null) createMenu.removeAttribute("nonnative");
        else createMenu.setAttribute("nonnative", originalNative);
      });
      const { gZenBoostsManager } = ChromeUtils.importESModule(
        "resource:///modules/zen/boosts/ZenBoostsManager.sys.mjs",
      );
      const items = [
        ["cmd_zenOpenWorkspaceCreation", "New Space", "new-space"],
        ["cmd_zenOpenFolderCreation", "New Folder", "new-folder"],
        ["cmd_zenNewEmptySplit", "New Split", "new-split"],
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
          `chrome://arc-ui/content/menu-icons/${image}.svg`,
        );
        item.classList.add("menuitem-iconic");
        if (command === "cmd_newNavigatorTab")
          item.setAttribute("key", "key_newNavigatorTab");
      }
      const split = createMenu.querySelector(
        '[command="cmd_zenNewEmptySplit"]',
      );
      const tab = createMenu.querySelector('[command="cmd_newNavigatorTab"]');
      if (split) {
        // A command broadcaster would overwrite this item's disabled state.
        split.removeAttribute("command");
        const runSplit = () => {
          if (!split.disabled)
            document.getElementById("cmd_zenNewEmptySplit")?.dispatchEvent(
              new window.Event("command", { bubbles: true }),
            );
        };
        split.addEventListener("command", runSplit);
        cleanups.push(() => {
          split.removeEventListener("command", runSplit);
          split.setAttribute("command", "cmd_zenNewEmptySplit");
        });
      }
      const boost = document.createXULElement("menuitem");
      boost.id = "arc-new-boost";
      boost.classList.add("menuitem-iconic");
      boost.setAttribute("label", "New Boost");
      boost.setAttribute(
        "image",
        "chrome://arc-ui/content/menu-icons/new-boost.svg",
      );
      function createBoost() {
        const uri = gBrowser.currentURI;
        if (!gZenBoostsManager.canBoostSite(uri)) return;
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
          !document.getElementById("navigator-toolbox")?.hasAttribute("zen-has-empty-tab");
        boost.disabled = !hasPage || !gZenBoostsManager.canBoostSite(uri);
        if (split) {
          const command = document.getElementById("cmd_zenNewEmptySplit");
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
        popup.shadowRoot.querySelector("[data-arc-menu-style]")
      )
        return;
      const link = document.createElementNS(HTML, "link");
      link.rel = "stylesheet";
      link.href = "chrome://arc-ui/content/menu-popup.css";
      link.setAttribute("data-arc-menu-style", "");
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
