/* Shared HTML controls and SVG icons. Native XUL controls stay in their feature modules. */
var ArcUI = {
  install(window, dependencies = {}) {
    const { document, ChromeUtils } = window;
    const { createMotion } = dependencies;
    const HTML = "http://www.w3.org/1999/xhtml";
    const SVG = "http://www.w3.org/2000/svg";
    const motion = createMotion(window);
    const { animate, reduced } = motion;
    const { actionIcon } = ChromeUtils.importESModule(
      "chrome://arc-ui/content/download-icons.sys.mjs",
    );
    function el(tag, attrs = {}, text) {
      const node = document.createElementNS(HTML, tag);
      for (const [key, value] of Object.entries(attrs))
        node.setAttribute(key, String(value));
      if (text !== undefined) node.textContent = text;
      return node;
    }
    const paths = {
      panel: ["M9 3v18", "M3 3h18v18H3z"],
      back: ["m12 5-7 7 7 7", "M5 12h14"],
      forward: ["m12 5 7 7-7 7", "M5 12h14"],
      reload: [
        "M20 11a8 8 0 0 0-14.8-4L4 9",
        "M4 4v5h5",
        "M4 13a8 8 0 0 0 14.8 4L20 15",
        "M20 20v-5h-5",
      ],
      stop: ["M6 6h12v12H6z"],
      close: ["m6 6 12 12", "M6 18 18 6"],
      gift: [
        "M3 8h18v4H3z",
        "M5 12v9h14v-9",
        "M12 8v13",
        "M12 8H8a3 3 0 1 1 3-3z",
        "M12 8h4a3 3 0 1 0-3-3z",
      ],
      file: [
        "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
        "M14 2v6h6",
        "M8 13h8",
        "M8 17h6",
      ],
      download: ["M12 3v12", "m7 10 5 5 5-5", "M5 17v4h14v-4"],
      media: ["M3 3h18v18H3z", "m3 17 6-6 4 4 3-3 5 5"],
      film: [
        "M4 3h16v18H4z",
        "M8 3v18",
        "M16 3v18",
        "M4 8h4",
        "M4 16h4",
        "M16 8h4",
        "M16 16h4",
      ],
      music: [
        "M9 18V5l12-2v13",
        "M9 18a3 3 0 1 1-3-3h3",
        "M21 16a3 3 0 1 1-3-3h3",
      ],
      fileArchive: [
        "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
        "M14 2v6h6",
        "M9 3v2m0 2v2m0 2v2",
        "M8 16h2v3H8z",
      ],
      easels: ["M3 3h18v13H3z", "m8 21 4-5 4 5"],
      spaces: [
        "M3 3h8v8H3z",
        "M14 3h7v8h-7z",
        "M3 14h8v7H3z",
        "M14 14h7v7h-7z",
      ],
      boosts: ["m14 3 7 7-10 10H4v-7z", "m12 5 7 7"],
      archive: ["M3 3h18v4H3z", "M5 7v14h14V7", "M9 11h6"],
      pause: ["M8 5v14", "M16 5v14"],
      play: ["m7 4 14 8-14 8z"],
      folder: [
        "M20 20H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2z",
      ],
    };
    function icon(name) {
      const svg = document.createElementNS(SVG, "svg");
      // 2 units at 24px becomes 1.5px at our 18px toolbar size, matching Zen.
      for (const [k, v] of Object.entries({
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "2",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
      }))
        svg.setAttribute(k, v);
      for (const d of paths[name] || paths.file) {
        const p = document.createElementNS(SVG, "path");
        p.setAttribute("d", d);
        svg.append(p);
      }
      return svg;
    }
    const nudges = {
      back: { x: -4 },
      forward: { x: 4 },
      reload: { rotate: -50 },
      panel: { x: -3 },
      gift: { y: -3, rotate: -12 },
      close: { rotate: 90 },
      file: { y: -2 },
    };
    function nudge(button, name) {
      if (reduced()) return;
      const i = button.querySelector("svg"),
        p = nudges[name] || {};
      if (!i || i.getAnimations().length) return;
      const pose = `translate(${p.x || 0}px,${p.y || 0}px) rotate(${p.rotate || 0}deg)`;
      void animate(
        i,
        [
          { transform: "none" },
          { transform: pose, offset: 0.35 },
          { transform: "none" },
        ],
        { duration: 430, easing: "cubic-bezier(.22,1,.36,1)" },
      );
    }
    function button(label, name, action) {
      const b = el("button", {
        type: "button",
        title: label,
        "aria-label": label,
        class: "arc-icon-button",
      });
      b.append(icon(name));
      b.addEventListener("click", action);
      b.addEventListener("pointerdown", (e) => {
        if (e.button === 0) nudge(b, name);
      });
      return b;
    }
    function downloadButton(label, name, action) {
      const b = el("button", {
        type: "button",
        title: label,
        "aria-label": label,
        class: "arc-icon-button",
      });
      b.append(
        el("img", { src: actionIcon(name), alt: "", "aria-hidden": "true" }),
      );
      b.addEventListener("click", action);
      return b;
    }

    return { el, icon, nudge, button, downloadButton, destroy: motion.destroy };
  },
};
