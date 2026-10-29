/* Initial sidebar width and the native splitter gesture that would reset it. */
var ArcSidebarWidth = {
  install(window, dependencies = {}) {
    const { document } = window;
    const { Services } = dependencies;
    // Keep Zen's native splitter and persisted width after the initial theme setup.
    if (!Services.prefs.getBoolPref("arc-ui.width-initialized", false)) {
      const toolbox = document.getElementById("navigator-toolbox");
      toolbox.style.width = "264px";
      toolbox.style.setProperty("--zen-sidebar-width", "264px");
      toolbox.setAttribute("width", "264px");
      Services.prefs.setBoolPref("arc-ui.width-initialized", true);
    }
    // Zen resets the sidebar to its platform default on splitter double-click.
    // Intercept only that gesture; leave native pointer-based resizing intact.
    function preventSidebarWidthReset(event) {
      if (event.button !== 0 || event.target.id !== "zen-sidebar-splitter")
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    window.addEventListener("dblclick", preventSidebarWidthReset, true);

    return {
      destroy() {
        window.removeEventListener("dblclick", preventSidebarWidthReset, true);
      },
    };
  },
};
