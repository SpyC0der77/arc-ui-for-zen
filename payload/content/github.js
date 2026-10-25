/* Use Zen's session-backed Live Folders; no separate credentials or tab store. */
var ArcGitHub = {
  async setup({ manager, prefs, isPrivate = false, isPrivateWindow = () => false }) {
    const key = "arc-ui.github-folders-initialized";
    if (isPrivate) return false;
    if (prefs.getBoolPref(key, false)) return true;
    const canCreate = () => manager.window && !manager.window.closed && !isPrivateWindow(manager.window);
    // The native manager is shared across browser windows.
    if (manager.arcGitHubSetup) return manager.arcGitHubSetup;
    manager.arcGitHubSetup = (async () => {
      await manager.stateRestored.promise;
      if (prefs.getBoolPref(key, false)) return true;
      if (!canCreate()) return false;
      for (const type of ["pull-requests", "issues"]) {
        const exists = [...manager.liveFolders.values()].some(folder =>
          folder.constructor.type === "github" && folder.state.type === type);
        if (exists) continue;
        if (!canCreate()) return false;
        const id = await manager.createFolder(`github:${type}`);
        const provider = manager.getFolder(id);
        if (!provider) throw new Error(`Could not create GitHub ${type} Live Folder`);
        Object.assign(provider.state.options, {
          authorMe: true, assignedMe: true, reviewRequested: type === "pull-requests"
        });
        provider.requestSave();
      }
      // Deleting a folder later is intentional; do not recreate it on restart.
      prefs.setBoolPref(key, true);
      return true;
    })();
    try { return await manager.arcGitHubSetup; }
    finally { delete manager.arcGitHubSetup; }
  },
  start({ schedule, cancel, isClosed, onError, ...options }) {
    let stopped = false, timer = null, failures = 0;
    async function attempt() {
      timer = null;
      if (stopped || isClosed() || options.isPrivate) return;
      try {
        if (await ArcGitHub.setup(options)) return;
      } catch (error) { onError(error); }
      // Retry partial setup in this session. The shared task prevents duplicates
      // across windows, and setup always rechecks Zen's current target window.
      if (!stopped && !isClosed()) {
        const delay = Math.min(300000, 1000 * 2 ** Math.min(failures++, 9));
        timer = schedule(attempt, delay);
      }
    }
    void attempt();
    return () => { stopped = true; if (timer !== null) cancel(timer); };
  }
};
