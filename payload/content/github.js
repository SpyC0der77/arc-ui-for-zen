/* Use Zen's session-backed Live Folders; no separate credentials or tab store. */
var ArcGitHub = {
  async setup({ manager, prefs, isPrivate = false, isClosed = () => false }) {
    const key = "arc-ui.github-folders-initialized";
    if (isPrivate || prefs.getBoolPref(key, false)) return;
    // The native manager is shared across browser windows.
    if (manager.arcGitHubSetup) return manager.arcGitHubSetup;
    manager.arcGitHubSetup = (async () => {
      await manager.stateRestored.promise;
      if (isClosed() || prefs.getBoolPref(key, false)) return;
      for (const type of ["pull-requests", "issues"]) {
        const exists = [...manager.liveFolders.values()].some(folder =>
          folder.constructor.type === "github" && folder.state.type === type);
        if (exists) continue;
        if (isClosed()) return;
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
    })();
    try { return await manager.arcGitHubSetup; }
    finally { delete manager.arcGitHubSetup; }
  }
};
