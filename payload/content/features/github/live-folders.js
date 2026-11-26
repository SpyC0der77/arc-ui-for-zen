/* Connect the GitHub provider to native live folders; never run in private windows. */
var ZenniaGitHubFolders = {
  install(window, dependencies = {}) {
    const { ChromeUtils } = window;
    const { Services, PrivateBrowsingUtils, createMotion } = dependencies;
    const motion = createMotion(window);
    const { later, clear } = motion;
    let stopGithubSetup = () => {};
    if (!PrivateBrowsingUtils.isWindowPrivate(window)) {
      try {
        const { ZenLiveFoldersManager } = ChromeUtils.importESModule(
          "resource:///modules/zen/ZenLiveFoldersManager.sys.mjs",
        );
        const github = {};
        Services.scriptloader.loadSubScript(
          "chrome://zennia/content/github.js",
          github,
          "UTF-8",
        );
        stopGithubSetup = github.ZenniaGitHub.start({
          manager: ZenLiveFoldersManager,
          prefs: Services.prefs,
          isPrivateWindow: (win) => PrivateBrowsingUtils.isWindowPrivate(win),
          isClosed: () => window.closed,
          schedule: later,
          cancel: clear,
          onError: (error) =>
            window.console.error(
              "[Zennia] GitHub Live Folders setup failed; retrying",
              error,
            ),
        });
      } catch (error) {
        window.console.error("[Zennia] GitHub Live Folders unavailable", error);
      }
    }

    return {
      destroy() {
        stopGithubSetup();
        motion.destroy();
      },
    };
  },
};
