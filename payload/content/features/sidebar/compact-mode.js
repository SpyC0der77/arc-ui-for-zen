/* Animate native dock/undock transitions and require pointer exit before hover can reopen the sidebar. */
var ArcCompactSidebar = {
  install(window, dependencies = {}) {
    const { document, DOMRect } = window;
    const { el, createMotion, hideDownloads, updateNav } = dependencies;
    const getComputedStyle = window.getComputedStyle.bind(window);
    const root = document.documentElement;
    const toolbox = document.getElementById("navigator-toolbox");
    const content = document.getElementById("zen-tabbox-wrapper");
    const compactMode = window.gZenCompactModeManager;
    let destroyed = false;
    const motion = createMotion(window);
    const { animate, reduced } = motion;
    const originalUpdate = compactMode._updateEvent;
    const originalExpand = compactMode._setElementExpandAttribute;
    let sidebarAnimating = false,
      sidebarRearmBounds = null,
      sidebarPointer = null;
    // A click on Undock leaves the pointer inside the old sidebar. Native hover
    // timers expire before the user has moved away, so require an actual exit.
    const expandSidebar = (compactMode._setElementExpandAttribute = function (
      element,
      value,
      attr = "zen-has-hover",
    ) {
      if (
        element === toolbox &&
        value &&
        attr === "zen-has-hover" &&
        sidebarRearmBounds
      )
        return;
      return originalExpand.call(this, element, value, attr);
    });
    function rearmSidebarHover(event) {
      sidebarPointer = { x: event.clientX, y: event.clientY };
      if (!sidebarRearmBounds || sidebarAnimating) return;
      const away = compactMode.sidebarIsOnRight
        ? event.clientX < sidebarRearmBounds.left - 8
        : event.clientX > sidebarRearmBounds.right + 8;
      if (away) sidebarRearmBounds = null;
    }
    window.addEventListener("pointermove", rearmSidebarHover, true);
    window.addEventListener("pointerdown", rearmSidebarHover, true);
    const updateCompactMode = (compactMode._updateEvent = async function (
      ...args
    ) {
      if (destroyed || sidebarAnimating) return;
      sidebarAnimating = true;
      const before = content.getBoundingClientRect(),
        sideBefore = toolbox.getBoundingClientRect();
      const wasCompact = this.preference;
      const panel = document.getElementById("zen-toolbar-background");
      const panelBefore = panel.getBoundingClientRect(),
        panelStyle = getComputedStyle(panel);
      const peekVisible =
        wasCompact &&
        panelStyle.visibility === "visible" &&
        panelBefore.right > 24 &&
        panelBefore.left < window.innerWidth - 24;
      const panelRadius = peekVisible ? panelStyle.borderRadius : "12px";
      const panelShadow = peekVisible ? panelStyle.boxShadow : "none";
      // These siblings are reparented by Zen when compact mode changes. Preserve
      // their screen positions independently of the sidebar's outer padding.
      const parts = peekVisible
        ? ["arc-top-controls", "nav-bar", "TabsToolbar"].map((id) => {
            const node = document.getElementById(id);
            return {
              node,
              before: node.getBoundingClientRect(),
              flex: node.getAttribute("flex"),
            };
          })
        : [];
      const pointerOverSidebar = sidebarPointer
        ? sidebarPointer.x >= sideBefore.left - 8 &&
          sidebarPointer.x <= sideBefore.right + 8
        : toolbox.matches(":hover");
      sidebarRearmBounds =
        !wasCompact && pointerOverSidebar ? sideBefore : null;
      let snapshot = null,
        ghost = null,
        surface = null;
      try {
        if (
          !wasCompact &&
          !reduced() &&
          sideBefore.width &&
          sideBefore.height
        ) {
          try {
            snapshot =
              await window.browsingContext.currentWindowGlobal.drawSnapshot(
                new DOMRect(
                  sideBefore.x,
                  sideBefore.y,
                  sideBefore.width,
                  sideBefore.height,
                ),
                window.devicePixelRatio,
                "transparent",
              );
          } catch (error) {
            window.console.warn("[Arc UI] Sidebar snapshot unavailable", error);
          }
        }
        if (destroyed) return;
        // Capture the still sidebar before native hover state can move it.
        if (!wasCompact) {
          this.clearFlashTimeout("has-hover" + toolbox.id);
          originalExpand.call(this, toolbox, false);
          toolbox.removeAttribute("zen-user-show");
        }
        if (!reduced())
          root.setAttribute(
            "data-arc-sidebar-animating",
            wasCompact ? "opening" : "closing",
          );
        await originalUpdate.apply(this, args);
        const after = content.getBoundingClientRect(),
          sideAfter = toolbox.getBoundingClientRect();
        if (
          after.width &&
          after.height &&
          !reduced() &&
          wasCompact !== this.preference
        ) {
          root.setAttribute(
            "data-arc-sidebar-animating",
            this.preference ? "closing" : "opening",
          );
          const timing = {
            duration: this.preference ? 180 : 220,
            easing: "cubic-bezier(.2,.7,.3,1)",
            fill: "both",
          };
          // Resize live content on the same clock. Do not scale text or images.
          const motions = [
            animate(
              content,
              [
                {
                  flex: "0 0 auto",
                  width: `${before.width}px`,
                  transform: `translateX(${before.x - after.x}px)`,
                },
                {
                  flex: "0 0 auto",
                  width: `${after.width}px`,
                  transform: "translateX(0)",
                },
              ],
              timing,
            ),
          ];
          if (this.preference && snapshot) {
            ghost = el("canvas", {
              id: "arc-sidebar-transition",
              "aria-hidden": "true",
            });
            ghost.width = snapshot.width;
            ghost.height = snapshot.height;
            Object.assign(ghost.style, {
              left: `${sideBefore.x}px`,
              top: `${sideBefore.y}px`,
              width: `${sideBefore.width}px`,
              height: `${sideBefore.height}px`,
            });
            ghost.getContext("2d").drawImage(snapshot, 0, 0);
            document.body.append(ghost);
            const exit = this.sidebarIsOnRight
              ? window.innerWidth - sideBefore.left
              : -sideBefore.right;
            motions.push(
              animate(
                ghost,
                [
                  {
                    transform: "translateX(0)",
                    clipPath: "inset(0px round 0px)",
                  },
                  {
                    transform: `translateX(${exit}px)`,
                    clipPath: "inset(5px 0px round 12px)",
                  },
                ],
                timing,
              ),
            );
          } else if (!this.preference) {
            const from = peekVisible
              ? panelBefore.x - sideAfter.x
              : this.sidebarIsOnRight
                ? window.innerWidth - sideAfter.left
                : -sideAfter.right;
            const top = peekVisible ? panelBefore.top - sideAfter.top : 5;
            const bottom = peekVisible
              ? sideAfter.bottom - panelBefore.bottom
              : 5;
            const clip = `inset(${top}px 0px ${bottom}px 0px round ${panelRadius})`;
            // One painted surface, with the same outline clipping every native
            // child. A rounded background alone leaves square ancestors visible.
            surface = el("div", {
              id: "arc-sidebar-surface",
              "aria-hidden": "true",
            });
            Object.assign(surface.style, {
              left: `${sideAfter.x}px`,
              top: `${sideAfter.y}px`,
              width: `${sideAfter.width}px`,
              height: `${sideAfter.height}px`,
            });
            toolbox.after(surface);
            const partFrames = parts.map(({ node, before }) => {
              const after = node.getBoundingClientRect();
              return {
                node,
                frames: [
                  {
                    flex: "0 0 auto",
                    minHeight: "0px",
                    transform: `translate(${before.x - after.x - from}px,${before.y - after.y}px)`,
                    width: `${before.width}px`,
                    height: `${before.height}px`,
                  },
                  {
                    flex: "0 0 auto",
                    minHeight: "0px",
                    transform: "translate(0px,0px)",
                    width: `${after.width}px`,
                    height: `${after.height}px`,
                  },
                ],
              };
            });
            // XUL's flex attribute has a UA-important sizing rule which outranks
            // Web Animations. Restore it after the measured heights have settled.
            for (const { node } of parts) node.removeAttribute("flex");
            motions.push(
              animate(
                surface,
                [
                  {
                    transform: `translateX(${from}px)`,
                    top: `${sideAfter.top + top}px`,
                    height: `${sideAfter.height - top - bottom}px`,
                    borderRadius: panelRadius,
                    boxShadow: panelShadow,
                  },
                  {
                    transform: "translateX(0)",
                    top: `${sideAfter.top}px`,
                    height: `${sideAfter.height}px`,
                    borderRadius: "0px",
                    boxShadow: "none",
                  },
                ],
                timing,
              ),
            );
            motions.push(
              animate(
                toolbox,
                [
                  { transform: `translateX(${from}px)`, clipPath: clip },
                  {
                    transform: "translateX(0)",
                    clipPath: "inset(0px round 0px)",
                  },
                ],
                timing,
              ),
            );
            for (const { node, frames } of partFrames)
              motions.push(animate(node, frames, timing));
          }
          await Promise.all(motions);
        }
      } finally {
        for (const { node, flex } of parts)
          if (flex !== null) node.setAttribute("flex", flex);
        snapshot?.close();
        ghost?.remove();
        surface?.remove();
        root.removeAttribute("data-arc-sidebar-animating");
        sidebarAnimating = false;
        if (!destroyed) updateNav();
      }
    });
    function toggleDock() {
      if (destroyed || sidebarAnimating) return;
      hideDownloads();
      compactMode.toggle(true);
    }

    function key(event) {
      if (
        event.key === "b" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleDock();
      }
    }
    window.addEventListener("keydown", key, true);

    return {
      toggleDock,
      isHoverBlocked: () => !!sidebarRearmBounds,
      destroy() {
        destroyed = true;
        motion.destroy();
        if (compactMode._updateEvent === updateCompactMode)
          compactMode._updateEvent = originalUpdate;
        if (compactMode._setElementExpandAttribute === expandSidebar)
          compactMode._setElementExpandAttribute = originalExpand;
        window.removeEventListener("pointermove", rearmSidebarHover, true);
        window.removeEventListener("pointerdown", rearmSidebarHover, true);
        window.removeEventListener("keydown", key, true);
      },
    };
  },
};
