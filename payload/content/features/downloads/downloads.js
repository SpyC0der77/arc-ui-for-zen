/* Recent-download popup, native download list, and file-arrival animation. */
var ArcDownloads = {
  install(window, dependencies = {}) {
    const { document, gBrowser } = window;
    const {
      Services,
      Downloads,
      PrivateBrowsingUtils,
      PathUtils,
      el,
      icon,
      nudge,
      downloadButton,
      gift,
      isLibraryOpen,
      status,
      report,
      createMotion,
      createRows,
    } = dependencies;
    const root = document.documentElement;
    const toolbox = document.getElementById("navigator-toolbox");
    const motion = createMotion(window);
    const { later, clear, animate, reduced } = motion;
    let destroyed = false;
    // Keep this in the sidebar's hover tree. The top layer lets it paint outside
    // Zen's sidebar clipping and stacking contexts without turning into a native panel.
    const popup = el("section", {
      id: "arc-download-popup",
      class: "arc-ui",
      hidden: "true",
      popover: "manual",
      "data-arc-download-design": "arc",
      "aria-label": "Downloads",
      role: "region",
    });
    const popupContent = el("div", { class: "arc-download-content" });
    const list = el("ul", { class: "arc-download-list" });
    popupContent.append(list);
    popup.append(popupContent);
    toolbox.append(popup);
    // Keep native download bookkeeping, but route native panel requests to this UI.
    const originalShowDownloadsPanel = window.DownloadsPanel.showPanel;
    window.DownloadsPanel.showPanel = function () {
      openDownloads();
      return Promise.resolve();
    };
    function interceptDownloadsPanel(event) {
      if (event.target.id !== "downloadsPanel") return;
      event.preventDefault();
      openDownloads();
    }
    document.addEventListener("popupshowing", interceptDownloadsPanel, true);
    const layer = el("div", {
      id: "arc-file-layer",
      class: "arc-ui",
      "aria-hidden": "true",
    });
    document.body.append(layer);

    // A motion counter prevents an old close animation from hiding a reopened popup.
    let closeTimer = 0,
      arrivalTimer = 0,
      restoringGiftFocus = false,
      flightsInProgress = 0,
      popupClosing = false,
      popupMotion = 0;
    const inside = () =>
      popup.matches(":hover") ||
      gift.matches(":hover") ||
      popup.contains(document.activeElement) ||
      gift === document.activeElement;
    function placePopup() {
      const r = gift.getBoundingClientRect();
      const sidebar = toolbox.getBoundingClientRect();
      const width = Math.min(
        Math.max(sidebar.width, 200),
        264,
        window.innerWidth - 16,
      );
      const left = r.right > 0 ? Math.max(0, sidebar.left) : 8;
      popup.style.width = `${width}px`;
      popup.style.left = `${Math.max(0, Math.min(window.innerWidth - width, left))}px`;
      popup.style.bottom = `${r.bottom > 0 ? Math.max(12, window.innerHeight - r.top + 6) : 52}px`;
    }
    function openDownloads() {
      if (destroyed) return;
      if (
        flightsInProgress ||
        isLibraryOpen() ||
        root.hasAttribute("inDOMFullscreen")
      )
        return;
      clear(closeTimer);
      placePopup();
      const wasHidden = popup.hidden || popupClosing;
      popupClosing = false;
      ++popupMotion;
      if (wasHidden)
        for (const detail of list.querySelectorAll("[data-download-time]"))
          detail.textContent = downloadAge({
            endTime: Number(detail.dataset.downloadTime),
          });
      if (wasHidden)
        for (const node of [popup, ...list.children])
          for (const motion of node.getAnimations()) motion.cancel();
      popup.hidden = false;
      gift.setAttribute("aria-expanded", "true");
      if (!popup.matches(":popover-open")) popup.showPopover();
      if (wasHidden) {
        void animate(popup, [{ opacity: 0 }, { opacity: 1 }], {
          duration: 160,
          easing: "ease-out",
        });
        const rows = [...list.children];
        for (const [index, row] of rows.entries()) {
          const rise = Math.max(8, Math.min(320, riseFromGift(row)));
          void animate(
            row,
            [
              { opacity: 0, transform: `translateY(${rise}px) scale(.92)` },
              { opacity: 1, transform: "none" },
            ],
            {
              duration: 260,
              delay: Math.min(rows.length - 1 - index, 5) * 24,
              easing: "cubic-bezier(.16,1,.3,1)",
              fill: "backwards",
            },
          );
        }
      }
    }
    function riseFromGift(row) {
      return gift.getBoundingClientRect().top - row.getBoundingClientRect().top;
    }
    function hideDownloads(soft = false) {
      const motion = ++popupMotion;
      gift.setAttribute("aria-expanded", "false");
      clear(closeTimer);
      clear(arrivalTimer);
      const finish = () => {
        if (motion !== popupMotion) return;
        if (popup.matches(":popover-open")) popup.hidePopover();
        popup.hidden = true;
        popupClosing = false;
      };
      for (const node of [popup, ...list.children])
        for (const animation of node.getAnimations()) animation.cancel();
      if (soft && !popup.hidden && !reduced()) {
        popupClosing = true;
        void animate(
          popup,
          [
            { opacity: 1, transform: "none" },
            { opacity: 0, transform: "translateY(8px)" },
          ],
          { duration: 140, easing: "ease-in" },
        ).then(finish);
      } else finish();
    }
    function scheduleClose() {
      clear(closeTimer);
      closeTimer = later(() => {
        if (!inside()) hideDownloads(true);
      }, 160);
    }
    function onPointerEnter() {
      clear(closeTimer);
      if (!isLibraryOpen()) openDownloads();
    }
    function onFocusIn() {
      clear(closeTimer);
      if (!restoringGiftFocus && !isLibraryOpen()) openDownloads();
    }
    for (const node of [gift, popup]) {
      node.addEventListener("pointerenter", onPointerEnter);
      node.addEventListener("pointerleave", scheduleClose);
      node.addEventListener("focusin", onFocusIn);
      node.addEventListener("focusout", scheduleClose);
    }
    function dismissDownloads(event) {
      if (
        !popup.hidden &&
        !popup.contains(event.target) &&
        !gift.contains(event.target)
      )
        hideDownloads();
    }
    document.addEventListener("pointerdown", dismissDownloads, true);
    async function runDownloadAction(download, action) {
      try {
        if (action === "open" || action === "show") hideDownloads();
        if (action === "open") await download.launch();
        else if (action === "show") await download.showContainingDirectory();
        else if (action === "pause") await download.cancel();
        else if (action === "resume") await download.start();
        else if (action === "cancel") {
          await download.cancel();
          await download.removePartialData();
        }
      } catch (error) {
        report(error);
      }
    }
    let records = [],
      ready = false,
      downloadList = null,
      debugDownloads = null;
    const rows = createRows(window, {
      PathUtils,
      el,
      icon,
      downloadButton,
      runDownloadAction,
    });
    const downloadAge = rows.downloadAge;
    function renderDownloads() {
      rows.render(list, debugDownloads ?? records);
    }
    // Initial list hydration renders existing files without replaying arrival effects.
    // Later additions animate only in the most recent browser window.
    const downloadView = {
      onDownloadAdded(download) {
        records.push(download);
        renderDownloads();
        if (
          debugDownloads === null &&
          ready &&
          Services.wm.getMostRecentWindow("navigator:browser") === window
        )
          void flight(window.gZenUIManager?._lastClickPosition);
      },
      onDownloadChanged() {
        renderDownloads();
      },
      onDownloadRemoved(download) {
        records = records.filter((record) => record !== download);
        renderDownloads();
      },
    };
    // Keep private-window downloads in their own list.
    Downloads.getList(
      PrivateBrowsingUtils.isWindowPrivate(window)
        ? Downloads.PRIVATE
        : Downloads.PUBLIC,
    )
      .then(async (nativeList) => {
        if (destroyed) return;
        downloadList = nativeList;
        await nativeList.addView(downloadView);
        if (destroyed) {
          nativeList.removeView(downloadView);
          return;
        }
        ready = true;
        renderDownloads();
      })
      .catch(report);
    function arrival() {
      nudge(gift, "gift");
      void animate(
        gift,
        [
          { backgroundColor: "#44375000" },
          { backgroundColor: "#44375024" },
          { backgroundColor: "#44375000" },
        ],
        { duration: 360, easing: "ease-out" },
      );
      openDownloads();
      clear(arrivalTimer);
      arrivalTimer = later(() => {
        if (!inside()) hideDownloads();
      }, 3000);
      status.textContent = "File added to downloads";
    }
    async function flight(position) {
      if (destroyed) return;
      if (document.hidden || root.hasAttribute("inDOMFullscreen")) return;
      // Native panel requests and trigger hover can happen while the file flies.
      // Keep every entry point closed until the last file has reached its gift.
      flightsInProgress++;
      hideDownloads();
      let sprite, fallback;
      try {
        if (reduced()) return;
        const r = gift.getBoundingClientRect();
        const visible =
          r.right > 0 &&
          r.left < window.innerWidth &&
          r.bottom > 0 &&
          r.top < window.innerHeight;
        const target = visible
          ? { x: r.x + r.width / 2, y: r.y + r.height / 2 }
          : { x: 28, y: window.innerHeight - 32 };
        const origin = {
          x: Math.max(
            20,
            Math.min(
              window.innerWidth - 20,
              position?.clientX ?? window.innerWidth / 2,
            ),
          ),
          y: Math.max(
            24,
            Math.min(
              window.innerHeight - 24,
              position?.clientY ?? window.innerHeight / 2,
            ),
          ),
        };
        sprite = el("div", {
          class: "arc-flying-file",
          "data-arc-flight": "true",
        });
        sprite.append(icon("file"));
        layer.append(sprite);
        if (!visible) {
          fallback = el("div", { class: "arc-fallback-gift" });
          fallback.append(icon("gift"));
          fallback.style.left = `${target.x - 10}px`;
          fallback.style.top = `${target.y - 10}px`;
          layer.append(fallback);
        }
        const lift = Math.min(
          240,
          Math.max(130, Math.abs(target.x - origin.x) * 0.28),
        );
        const apex = Math.max(24, Math.min(origin.y, target.y) - lift);
        const rise = Math.sqrt(Math.max(0, origin.y - apex)),
          fall = Math.sqrt(Math.max(0, target.y - apex));
        const gravity = (rise + fall) ** 2,
          launch = -2 * rise * (rise + fall);
        const interpolate = (t, ts, vs) => {
          let i = 0;
          while (i < ts.length - 2 && t > ts[i + 1]) i++;
          return (
            vs[i] + ((vs[i + 1] - vs[i]) * (t - ts[i])) / (ts[i + 1] - ts[i])
          );
        };
        const frames = Array.from({ length: 65 }, (_, i) => {
          const t = i / 64,
            x = origin.x + (target.x - origin.x) * t - 18,
            y = origin.y + launch * t + gravity * t * t - 22;
          const scale = interpolate(t, [0, 0.12, 0.9, 1], [1, 1.08, 1, 0.12]),
            rotate = interpolate(t, [0, 0.3, 0.85, 1], [-8, -26, 14, 0]),
            opacity = interpolate(t, [0, 0.05, 0.96, 1], [0, 1, 1, 0]);
          return {
            offset: t,
            transform: `translate(${x}px,${y}px) rotate(${rotate}deg) scale(${scale})`,
            opacity,
          };
        });
        await animate(sprite, frames, { duration: 1600, easing: "linear" });
      } finally {
        sprite?.remove();
        if (fallback) later(() => fallback.remove(), 240);
        flightsInProgress--;
        if (!destroyed && !flightsInProgress) arrival();
      }
    }

    function key(event) {
      if (event.key !== "Escape" || popup.hidden) return;
      event.preventDefault();
      hideDownloads();
      restoringGiftFocus = true;
      try {
        gift.focus();
      } finally {
        restoringGiftFocus = false;
      }
    }
    window.addEventListener("keydown", key, true);
    const onResize = () => {
      if (!popup.hidden) placePopup();
    };
    window.addEventListener("resize", onResize);

    return {
      openDownloads,
      hideDownloads,
      flight,
      renderDownloads,
      setDebugDownloads(items) {
        if (debugDownloads !== items) hideDownloads();
        debugDownloads = items;
        renderDownloads();
      },
      diagnostics: () => ({
        downloads: (debugDownloads ?? records).length,
        realDownloads: records.length,
        popup: !popup.hidden,
      }),
      destroy() {
        destroyed = true;
        hideDownloads();
        motion.destroy();
        window.DownloadsPanel.showPanel = originalShowDownloadsPanel;
        document.removeEventListener(
          "popupshowing",
          interceptDownloadsPanel,
          true,
        );
        document.removeEventListener("pointerdown", dismissDownloads, true);
        window.removeEventListener("keydown", key, true);
        window.removeEventListener("resize", onResize);
        for (const node of [gift, popup]) {
          node.removeEventListener("pointerenter", onPointerEnter);
          node.removeEventListener("pointerleave", scheduleClose);
          node.removeEventListener("focusin", onFocusIn);
          node.removeEventListener("focusout", scheduleClose);
        }
        if (downloadList) downloadList.removeView(downloadView);
        popup.remove();
        layer.remove();
      },
    };
  },
};
