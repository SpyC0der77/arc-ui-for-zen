/* Keep the tab hover highlight on the tab under a stationary pointer after a
   tab closes beneath it (middle-click or close button). Gecko occasionally
   leaves :hover on a tab elsewhere in the list once the rows shift; replaying
   a mousemove at the same point makes it hit-test the settled layout again. */
var ArcTabHoverSync = {
  install(window) {
    const { document } = window;
    let pointer = null;
    let frame = 0;
    let timer = 0;

    const track = (event) => {
      pointer = { x: event.clientX, y: event.clientY, buttons: event.buttons };
    };
    const forget = (event) => {
      if (!event.relatedTarget) pointer = null;
    };
    const tabAt = (x, y) =>
      document.elementFromPoint(x, y)?.closest?.(".tabbrowser-tab") || null;
    const resync = () => {
      if (!pointer || pointer.buttons) return;
      const { x, y } = pointer;
      const under = tabAt(x, y);
      const hovered = document.querySelector(".tabbrowser-tab:hover");
      if (under === hovered) return;
      // Gecko 15x replaced windowUtils.sendMouseEvent with a chrome-only
      // Window method; keep the old path for earlier supported releases.
      if (typeof window.synthesizeMouseEvent === "function")
        window.synthesizeMouseEvent("mousemove", x, y, { buttons: 0 },
          { isDOMEventSynthesized: false });
      else window.windowUtils?.sendMouseEvent?.("mousemove", x, y, 0, 0, 0);
    };
    const onClose = (event) => {
      const tab = event.target;
      if (!pointer || !tab?.getBoundingClientRect) return;
      const r = tab.getBoundingClientRect();
      const { x, y } = pointer;
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
      // Check once the row is gone, and again after Zen's close animation.
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(resync);
      });
      timer = window.setTimeout(resync, 400);
    };

    window.addEventListener("mousemove", track, { capture: true, passive: true });
    window.addEventListener("mouseout", forget, { capture: true, passive: true });
    window.addEventListener("TabClose", onClose);
    return {
      resync,
      destroy() {
        window.removeEventListener("mousemove", track, { capture: true });
        window.removeEventListener("mouseout", forget, { capture: true });
        window.removeEventListener("TabClose", onClose);
        window.cancelAnimationFrame(frame);
        window.clearTimeout(timer);
      },
    };
  },
};
