/* Open the bundled demo once, after Zen has completed its own onboarding. */
var ZenniaDemo = {
  install(window, dependencies = {}) {
    const { Services, PrivateBrowsingUtils, createMotion } = dependencies;
    const motion = createMotion(window);
    const { later } = motion;
    // Only open the demo once, after the browser's own onboarding has completed.
    if (
      !PrivateBrowsingUtils.isWindowPrivate(window) &&
      !Services.prefs.getBoolPref("zennia.demo-seen", false) &&
      Services.prefs.getBoolPref("zen.welcome-screen.seen", false)
    ) {
      Services.prefs.setBoolPref("zennia.demo-seen", true);
      later(
        () =>
          window.openTrustedLinkIn("chrome://zennia/content/home.xhtml", "tab"),
        500,
      );
    }

    return { destroy: motion.destroy };
  },
};
