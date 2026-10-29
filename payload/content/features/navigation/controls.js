/* Replacement navigation row; commands and loading state still come from Zen. */
var ArcNavigation = {
  install(window, dependencies = {}) {
    const { document, gBrowser, BrowserCommands, ResizeObserver } = window;
    const { el, button, icon, rememberAddress, toggleDock } = dependencies;
    const toolbox = document.getElementById("navigator-toolbox");
    const compactMode = window.gZenCompactModeManager;
    const controls = el("div", { id: "arc-top-controls", class: "arc-ui" });
    const toggle = button("Hide sidebar (Ctrl+B)", "panel", () => toggleDock());
    controls.append(toggle);
    toggle.id = "arc-sidebar-toggle";
    const nav = el("div", { id: "arc-navigation-controls" });
    const back = button("Back", "back", () => BrowserCommands.back());
    const forward = button("Forward", "forward", () =>
      BrowserCommands.forward(),
    );
    const reload = button("Reload", "reload", () =>
      gBrowser.selectedBrowser.isLoadingDocument
        ? BrowserCommands.stop()
        : BrowserCommands.reload(),
    );
    const appMenu =
      document.getElementById("PanelUI-menu-button") ||
      document.getElementById("zen-appmenu-button");
    const appMenuParent = appMenu?.parentNode;
    const appMenuNext = appMenu?.nextSibling;
    const appMenuAttributes = appMenu
      ? ["aria-label", "label"].map((name) => [
          name,
          appMenu.getAttribute(name),
        ])
      : [];
    const previousHeight = toolbox.style.getPropertyValue(
      "--arc-top-controls-height",
    );
    nav.append(back, forward, reload);
    if (appMenu) {
      appMenu.setAttribute(
        "aria-label",
        appMenu.getAttribute("aria-label") || "Open menu",
      );
      appMenu.setAttribute("label", "");
      nav.append(appMenu);
    }
    controls.append(nav);
    toolbox.prepend(controls);
    const syncControlsHeight = () =>
      toolbox.style.setProperty(
        "--arc-top-controls-height",
        `${controls.getBoundingClientRect().height}px`,
      );
    syncControlsHeight();
    const controlsResizeObserver = new ResizeObserver(syncControlsHeight);
    controlsResizeObserver.observe(controls);
    function updateNav() {
      rememberAddress();
      back.disabled = !gBrowser.canGoBack;
      forward.disabled = !gBrowser.canGoForward;
      const loading = gBrowser.selectedBrowser.isLoadingDocument;
      reload.replaceChildren(icon(loading ? "stop" : "reload"));
      reload.setAttribute("aria-label", loading ? "Stop loading" : "Reload");
      reload.title = reload.getAttribute("aria-label");
      toggle.setAttribute(
        "aria-label",
        `${compactMode.preference ? "Dock" : "Hide"} sidebar (Ctrl+B)`,
      );
      toggle.title = toggle.getAttribute("aria-label");
    }
    const navObserver = {
      onLocationChange: updateNav,
      onStateChange: updateNav,
    };
    gBrowser.addProgressListener(navObserver);
    gBrowser.tabContainer.addEventListener("TabSelect", updateNav);

    return {
      updateNav,
      destroy() {
        controlsResizeObserver.disconnect();
        gBrowser.removeProgressListener(navObserver);
        gBrowser.tabContainer.removeEventListener("TabSelect", updateNav);
        if (appMenuParent) {
          appMenuParent.insertBefore(
            appMenu,
            appMenuNext?.parentNode === appMenuParent ? appMenuNext : null,
          );
          for (const [name, value] of appMenuAttributes) {
            if (value === null) appMenu.removeAttribute(name);
            else appMenu.setAttribute(name, value);
          }
        }
        if (previousHeight)
          toolbox.style.setProperty(
            "--arc-top-controls-height",
            previousHeight,
          );
        else toolbox.style.removeProperty("--arc-top-controls-height");
        controls.remove();
      },
    };
  },
};
