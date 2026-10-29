/* Library trigger, native opening position, and footer links. Downloads only supply a hide callback. */
var ArcLibrary = {
  install(window, dependencies = {}) {
    const { document, MutationObserver } = window;
    const { icon, nudge, hideDownloads, report } = dependencies;
    const toolbox = document.getElementById("navigator-toolbox");
    const library = document.querySelector("zen-library");
    const footerButtons = new Set();
    const donateImages = new Map();
    function syncLibraryFooter() {
      const footer = library.querySelector("#zen-library-footer");
      const donate = footer?.querySelector(
        '[data-l10n-id="library-footer-donate-button"]',
      );
      if (!donate) return;
      if (!donateImages.has(donate))
        donateImages.set(donate, donate.getAttribute("image"));
      const heart = "chrome://arc-ui/content/menu-icons/heart.svg";
      if (donate.getAttribute("image") !== heart)
        donate.setAttribute("image", heart);
      if (footer.querySelector("#arc-project-github-button")) return;
      const github = document.createXULElement("toolbarbutton");
      github.id = "arc-project-github-button";
      github.className = "toolbarbutton-1";
      github.setAttribute(
        "image",
        "chrome://arc-ui/content/menu-icons/github.svg",
      );
      github.setAttribute("tooltiptext", "Arc UI for Zen on GitHub");
      github.setAttribute("aria-label", "Arc UI for Zen on GitHub");
      github.addEventListener("command", () => {
        window.openTrustedLinkIn(
          "https://github.com/SpyC0der77/arc-ui-for-zen",
          "tab",
        );
        void setRail(false).catch(report);
      });
      donate.after(github);
      footerButtons.add(github);
    }
    const footerObserver = new MutationObserver(syncLibraryFooter);
    footerObserver.observe(library, { childList: true, subtree: true });
    syncLibraryFooter();
    const NativeLibrary = library.constructor;
    const originalLibraryAnimate = NativeLibrary.animateProgress;
    function animateLibrary(target) {
      // Zen unhides the library before its spring's first progress update. Give
      // that first painted frame the same offscreen position as the slide.
      if (target === 1 && library.openProgress === 0) {
        library.style.transform = `translateX(${NativeLibrary.libraryOnRight ? 100 : -100}%)`;
      }
      return originalLibraryAnimate.call(this, target);
    }
    NativeLibrary.animateProgress = animateLibrary;
    function setRail(open) {
      if (open) hideDownloads();
      gift.setAttribute("aria-pressed", String(open));
      return NativeLibrary.animateProgress(open ? 1 : 0);
    }
    const gift = document.createXULElement("toolbarbutton");
    gift.id = "arc-gift-button";
    gift.className =
      "toolbarbutton-1 zen-sidebar-action-button arc-icon-button arc-ui";
    gift.setAttribute("aria-label", "Library (hover for downloads)");
    gift.append(icon("gift"));
    gift.addEventListener("command", () => {
      hideDownloads();
      void setRail(!NativeLibrary.isLibrarySlightlyOpen).catch(report);
    });
    gift.addEventListener("pointerdown", (e) => {
      if (e.button === 0) nudge(gift, "gift");
    });
    gift.setAttribute("aria-pressed", "false");
    gift.setAttribute("aria-expanded", "false");
    gift.setAttribute("aria-controls", "arc-download-popup");
    const libraryObserver = new MutationObserver(() =>
      gift.setAttribute(
        "aria-pressed",
        String(NativeLibrary.isLibrarySlightlyOpen),
      ),
    );
    libraryObserver.observe(library, {
      attributes: true,
      attributeFilter: ["open", "hidden", "transitioning"],
    });
    (document.getElementById("zen-sidebar-foot-buttons") || toolbox).prepend(
      gift,
    );

    return {
      gift,
      setRail,
      isOpen: () => NativeLibrary.isLibrarySlightlyOpen,
      destroy() {
        if (NativeLibrary.animateProgress === animateLibrary)
          NativeLibrary.animateProgress = originalLibraryAnimate;
        libraryObserver.disconnect();
        footerObserver.disconnect();
        gift.remove();
        for (const button of footerButtons) button.remove();
        for (const [donate, image] of donateImages) {
          if (image === null) donate.removeAttribute("image");
          else donate.setAttribute("image", image);
        }
        footerButtons.clear();
        donateImages.clear();
      },
    };
  },
};
