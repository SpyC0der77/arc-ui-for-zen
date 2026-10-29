/* Hold the platform accelerator to detach split tabs without closing them. */
var ArcSplitActions = {
  install(win) {
    const {document, gBrowser, gZenViewSplitter} = win;
    const root = document.documentElement;
    const mac = win.navigator.platform.startsWith("Mac");
    const saved = new Map();
    const attributes = ["tooltiptext", "aria-label", "data-l10n-id", "data-l10n-args"];
    let active = false;
    function refresh() {
      const buttons = new Set(active ? document.querySelectorAll("tab-group[split-view-group] .tab-close-button") : []);
      for (const [button, values] of saved) {
        if (buttons.has(button)) continue;
        for (const [name, value] of values) {
          if (value === null) button.removeAttribute(name);
          else button.setAttribute(name, value);
        }
        saved.delete(button);
      }
      for (const button of buttons) {
        if (saved.has(button)) continue;
        saved.set(button, attributes.map(name => [name, button.getAttribute(name)]));
        button.removeAttribute("data-l10n-id");
        button.removeAttribute("data-l10n-args");
        button.setAttribute("tooltiptext", "Unsplit tab");
        button.setAttribute("aria-label", "Unsplit tab");
      }
    }
    function setActive(value) {
      active = value;
      root.toggleAttribute("data-arc-unsplit-tabs", active);
      refresh();
    }
    function key(event) { setActive(mac ? event.metaKey : event.ctrlKey); }
    function blur(event) { if (event.target === win) setActive(false); }
    function press(event) {
      if (event.button !== 0) return;
      const button = event.target.closest?.(".tab-close-button");
      const tab = button?.closest(".tabbrowser-tab");
      if (!tab?.closest("tab-group[split-view-group]")) return;
      // Read the click's modifiers too, in case focus arrived while held.
      if (!active && !(mac ? event.metaKey : event.ctrlKey)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "click") return;
      gZenViewSplitter.removeTabFromSplit(event, tab.linkedBrowser.closest(".browserSidebarContainer"));
      refresh();
    }
    const observer = new win.MutationObserver(() => { if (active) refresh(); });
    observer.observe(gBrowser.tabContainer, {childList:true, subtree:true});
    win.addEventListener("keydown", key, true);
    win.addEventListener("keyup", key, true);
    win.addEventListener("blur", blur, true);
    for (const type of ["pointerdown", "mousedown", "click"]) win.addEventListener(type, press, true);
    return () => {
      observer.disconnect();
      setActive(false);
      win.removeEventListener("keydown", key, true);
      win.removeEventListener("keyup", key, true);
      win.removeEventListener("blur", blur, true);
      for (const type of ["pointerdown", "mousedown", "click"]) win.removeEventListener(type, press, true);
    };
  }
};
