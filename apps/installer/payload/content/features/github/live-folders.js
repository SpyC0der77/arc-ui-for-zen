/* Connect the GitHub provider to native live folders; never run in private windows. */
var ZenniaGitHubFolders = {
  install(window, dependencies = {}) {
    const { Services, PrivateBrowsingUtils, createMotion, zen } = dependencies;
    const motion = createMotion(window);
    const { later, clear } = motion;
    let stopGithubSetup = () => {};
    if (zen.features.liveFolders && !PrivateBrowsingUtils.isWindowPrivate(window)) {
      try {
        const ZenLiveFoldersManager = zen.import(
          "resource:///modules/zen/ZenLiveFoldersManager.sys.mjs",
          "ZenLiveFoldersManager",
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
