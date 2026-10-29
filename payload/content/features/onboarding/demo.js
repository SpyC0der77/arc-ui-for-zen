/* Open the bundled demo once, after Zen has completed its own onboarding. */
var ArcDemo = {
  install(window, dependencies = {}) {
    const { Services, PrivateBrowsingUtils, createMotion } = dependencies;
    const motion = createMotion(window);
    const { later } = motion;
    // Only open the demo once, after the browser's own onboarding has completed.
    if (
      !PrivateBrowsingUtils.isWindowPrivate(window) &&
      !Services.prefs.getBoolPref("arc-ui.demo-seen", false) &&
      Services.prefs.getBoolPref("zen.welcome-screen.seen", false)
    ) {
      Services.prefs.setBoolPref("arc-ui.demo-seen", true);
      later(
        () =>
          window.openTrustedLinkIn("chrome://arc-ui/content/home.xhtml", "tab"),
        500,
      );
    }

    return { destroy: motion.destroy };
  },
};
