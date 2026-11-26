/* Keep provider-owned lists and entries out of ordinary-folder editing flows. */
var ZenniaNativeActions = {
  folderActions: ["context_zenFolderUnpack", "context_zenFolderNewSubfolder", "context_zenFolderToSpace"], // zen.name() at use
  tabActions: ["context_zen-edit-tab-title", "context_zen-edit-pinned-page", "context_zen-edit-pinned-url", "context_zen-replace-pinned-url-with-current"], // zen.name() at use
  install({ document, contextTabs, zen }) {
    const folderMenu = document.getElementById(zen.name("zenFolderActions"));
    const tabMenu = document.getElementById("tabContextMenu");
    const marker = "data-zennia-provider-owned";
    const isLiveTab = tab => !!tab?.group?.isLiveFolder && tab.hasAttribute(zen.name("zen-live-folder-item-id"));
    function showing(event) {
      const menu = event.target;
      if (menu === folderMenu) {
        const target = menu.triggerNode ?? event.explicitOriginalTarget;
        const folder = target?.closest?.(zen.name("zen-folder"));
        menu.toggleAttribute(marker, !!folder?.isLiveFolder);
      } else if (menu === tabMenu) {
        menu.toggleAttribute(marker, contextTabs().some(isLiveTab));
      }
    }
    function command(event) {
      const menu = event.target.closest?.(zen.name("#zenFolderActions, #tabContextMenu"));
      if (!menu?.hasAttribute(marker)) return;
      const blocked = menu === folderMenu ? ZenniaNativeActions.folderActions : ZenniaNativeActions.tabActions;
      if (blocked.some(id => zen.name(id) === event.target.id)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    function hidden(event) {
      if (event.target === folderMenu || event.target === tabMenu) event.target.removeAttribute(marker);
    }
    document.addEventListener("popupshowing", showing);
    document.addEventListener("popuphidden", hidden);
    document.addEventListener("command", command, true);
    return () => {
      document.removeEventListener("popupshowing", showing);
      document.removeEventListener("popuphidden", hidden);
      document.removeEventListener("command", command, true);
      folderMenu?.removeAttribute(marker);
      tabMenu?.removeAttribute(marker);
    };
  }
};
