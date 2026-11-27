/* Zennia toasts in the bottom corner of a browser window (styles in toast.css).
   Uses only plain DOM and the popover top layer, so it also works while the rest
   of Zennia is paused on an untested Zen version. A toast with the same id is
   updated in place instead of stacking a second one. */
var ZenniaToast = {
  show(window, { id, kind = "info", title, description = "", action = null, onDismiss = null }) {
    const { document } = window;
    const container = this.container(window);
    // A toast that is already closing is left to finish; a new one takes its place.
    let toast = container.querySelector(`.zennia-toast[data-id="${id}"]:not([data-ending])`);
    const entering = !toast;
    if (!toast) {
      toast = this.element(document, "div", { class: "zennia-toast", role: "status", "data-id": id });
      toast.toggleAttribute("data-entering", true);
      container.append(toast);
    }
    toast.setAttribute("data-kind", kind);
    const html = (tag, attributes, text) => { const node = this.element(document, tag, attributes); if (text) node.textContent = text; return node; };
    const message = html("div", { class: "zennia-toast-message" });
    message.append(this.icon(document, kind, "zennia-toast-icon"), html("p", { class: "zennia-toast-title" }, title));
    const content = html("div", { class: "zennia-toast-content" });
    content.append(message);
    if (description) content.append(html("p", { class: "zennia-toast-description" }, description));
    const body = html("div", { class: "zennia-toast-body" });
    body.append(content);
    if (action) {
      const button = html("button", { class: "zennia-toast-action", type: "button" }, action.label);
      button.addEventListener("click", () => action.run());
      body.append(button);
    }
    const dismiss = html("button", { class: "zennia-toast-dismiss", type: "button", "aria-label": "Dismiss notification" });
    dismiss.append(this.icon(document, "close"));
    dismiss.addEventListener("click", () => { this.close(window, id); onDismiss?.(); });
    toast.replaceChildren(body, dismiss);
    if (entering) window.requestAnimationFrame(() => window.requestAnimationFrame(() => toast.removeAttribute("data-entering")));
    return { close: () => this.close(window, id) };
  },

  close(window, id) {
    const container = window.document.getElementById("zennia-toasts");
    const toast = container?.querySelector(`.zennia-toast[data-id="${id}"]:not([data-ending])`);
    if (!toast) return;
    toast.toggleAttribute("data-ending", true);
    const remove = () => {
      toast.remove();
      if (!container.childElementCount) { try { container.hidePopover(); } catch {} container.remove(); }
    };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) remove(); else window.setTimeout(remove, 220);
  },

  container(window) {
    const { document } = window;
    let container = document.getElementById("zennia-toasts");
    if (container) return container;
    if (!window.zenniaToastStyles) {
      window.windowUtils.loadSheetUsingURIString("chrome://zennia/content/shared/toast.css", window.windowUtils.AUTHOR_SHEET);
      window.zenniaToastStyles = true;
    }
    container = this.element(document, "section", { id: "zennia-toasts", popover: "manual", "aria-label": "Zennia notifications", "aria-live": "polite" });
    (document.body ?? document.documentElement).append(container);
    container.showPopover();
    return container;
  },

  element(document, tag, attributes) {
    const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  },

  // Lucide shapes, as in T3 Code's toasts.
  ICONS: {
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>',
    success: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    error: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
  },
  icon(document, name, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    if (className) svg.setAttribute("class", className);
    const shapes = new document.defaultView.DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${this.ICONS[name] ?? this.ICONS.info}</svg>`, "image/svg+xml").documentElement;
    svg.append(...shapes.childNodes);
    return svg;
  },
};
