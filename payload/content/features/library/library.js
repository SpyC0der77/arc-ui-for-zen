/* Library trigger, native opening position, and footer links. Downloads only supply a hide callback. */
var ArcLibrary = {
  install(window, dependencies = {}) {
    const { document, MutationObserver } = window;
    const { icon, nudge, hideDownloads, report } = dependencies;
    const toolbox = document.getElementById("navigator-toolbox");
    const library = document.querySelector("zen-library");
    if (typeof library?.constructor.animateProgress !== "function")
      return this.installLegacy(window, dependencies);
    const footerButtons = new Set();
    const { Services } = window;
    const prefBranch = "arc-ui.appearance.";
    const appearanceInputs = [];
    const appearance = [
      ["background", "Background", "--arc-surface", "#cec7d4", "#292630"],
      ["foreground", "Foreground text", "--arc-text", "#141414", "#f0edf3"],
      ["accent", "Accent text", "--arc-muted", "#65556f", "#e4d2f5"],
      ["popup", "Menu background", "--arc-popup-surface", "#f6f4f3", "#302c35"],
    ];
    // Preserve existing custom colors in both palettes on upgrade.
    for (const [key] of appearance) {
      if (!Services.prefs.prefHasUserValue(prefBranch + key)) continue;
      const value = Services.prefs.getStringPref(prefBranch + key);
      for (const mode of ["light", "dark"]) {
        if (!Services.prefs.prefHasUserValue(prefBranch + mode + "." + key))
          Services.prefs.setStringPref(prefBranch + mode + "." + key, value);
      }
      Services.prefs.clearUserPref(prefBranch + key);
    }
    function applyAppearance() {
      for (const [key, , variable, lightDefault, darkDefault] of appearance) {
        const values = ["light", "dark"].map((mode, index) => {
          const fallback = index ? darkDefault : lightDefault;
          const value = Services.prefs.getStringPref(prefBranch + mode + "." + key, fallback);
          return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
        });
        document.documentElement.style.setProperty(variable, `light-dark(${values[0]}, ${values[1]})`);
      }
      document.documentElement.toggleAttribute("data-arc-reduced-motion", Services.prefs.getBoolPref(prefBranch + "reduce-motion", false));
    }
    const appearanceObserver = { observe: applyAppearance };
    Services.prefs.addObserver(prefBranch, appearanceObserver);
    applyAppearance();
    const projectMenu = document.createXULElement("menupopup");
    projectMenu.id = "arc-project-menu";
    projectMenu.setAttribute("nonnative", "true");
    document.getElementById("mainPopupSet").append(projectMenu);
    const settings = document.createElementNS("http://www.w3.org/1999/xhtml", "dialog");
    settings.id = "arc-settings-dialog";
    settings.setAttribute("aria-labelledby", "arc-settings-title");
    function html(tag, text) {
      const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
      node.textContent = text;
      return node;
    }
    const title = html("h2", "Arc UI settings");
    title.id = "arc-settings-title";
    const description = html("p", "Make this space your own.");
    const colors = html("button", "Configure colors");
    colors.type = "button";
    colors.addEventListener("click", (event) => {
      settings.close();
      window.gZenThemePicker.openThemePicker(event);
    });
    const note = html("p", "Colors are saved to your current Zen workspace.");
    const close = html("button", "Done");
    close.type = "button";
    close.addEventListener("click", () => settings.close());
    settings.append(title, description);
    const heading = html("div", "");
    heading.className = "arc-palette-heading";
    heading.append(html("span", "Colors"), html("span", "☀ Light"), html("span", "☾ Dark"));
    settings.append(heading);
    let activeColor = null;
    let editorWindow = null;
    function refreshColorInputs() {
      for (const entry of appearanceInputs) {
        const { input, key, mode, fallback } = entry;
        entry.value = Services.prefs.getStringPref(prefBranch + mode + "." + key, fallback);
        input.style.setProperty("--swatch", entry.value);
        input.title = `${entry.label} · ${mode} · ${entry.value}`;
        input.textContent = "";
      }
    }
    for (const [key, label, , fallback, darkDefault] of appearance) {
      const row = html("div", "");
      row.className = "arc-settings-row arc-color-row";
      row.append(html("span", label));
      const pair = html("div", "");
      pair.className = "arc-color-pair";
      for (const mode of ["light", "dark"]) {
        const input = html("button", "");
        input.type = "button";
        input.className = "arc-color-swatch";
        input.setAttribute("aria-label", `${label}, ${mode} mode`);
        input.setAttribute("aria-expanded", "false");
        const entry = { input, key, mode, label, fallback: mode === "dark" ? darkDefault : fallback };
        input.addEventListener("click", () => openColorEditor(entry));
        appearanceInputs.push(entry);
        pair.append(input);
      }
      row.append(pair);
      settings.append(row);
    }
    refreshColorInputs();
    const editor = html("section", "");
    editor.id = "arc-color-editor";
    editor.hidden = true;
    const editorTitle = html("h3", "");
    const pickerHost = html("div", "");
    const pickerRoot = pickerHost.attachShadow({ mode: "open" });
    const pickerStyles = html("link", "");
    pickerStyles.rel = "stylesheet";
    pickerStyles.href = "chrome://browser/content/zen-styles/zen-boosts.css";
    const field = html("div", "");
    field.className = "zen-boost-color-picker-gradient";
    // Keep the native Boosts inset, translucent veil, dotted texture and
    // blurred spectrum. Overriding these with a radial gradient exposes the
    // saturated conic layer and loses the native picker appearance.
    field.style.cssText = "width:152px;height:152px;min-height:0;margin:0 auto;touch-action:none;--zen-boosts-color-picker-background:light-dark(#fbfbfdea,#1c1c1eea);--zen-boosts-color-picker-pattern-color:light-dark(#e3e9e4,#3a3a3a)";
    const dot = html("div", "");
    dot.className = "zen-boost-color-picker-dot";
    dot.style.pointerEvents = "none";
    field.append(dot);
    pickerRoot.append(pickerStyles, field);
    let hue = 0, saturation = 0;
    const brightnessLabel = html("label", "Brightness");
    const brightness = html("input", "");
    brightness.type = "range";
    brightness.min = "0";
    brightness.max = "100";
    brightness.setAttribute("aria-label", "Brightness");
    brightnessLabel.append(brightness);
    const hexLabel = html("label", "Hex color");
    const hex = html("input", "");
    hex.type = "text";
    hex.maxLength = 7;
    hex.setAttribute("aria-label", "Hex color");
    hexLabel.append(hex);
    function positionDot() {
      const angle = (hue - 90) * Math.PI / 180;
      dot.style.left = `${50 + Math.cos(angle) * saturation * 43}%`;
      dot.style.top = `${50 + Math.sin(angle) * saturation * 43}%`;
      dot.style.setProperty("--zen-theme-picker-dot-color", hex.value);
    }
    function saveColor(value) {
      if (!activeColor || !/^#[0-9a-f]{6}$/i.test(value)) return;
      Services.prefs.setStringPref(prefBranch + activeColor.mode + "." + activeColor.key, value);
      hex.value = value;
      refreshColorInputs();
      positionDot();
    }
    function saveWheelColor() {
      const rgb = window.gZenThemePicker.hslToRgb(hue / 360, saturation, Number(brightness.value) / 100);
      saveColor("#" + rgb.map(v => Math.round(v).toString(16).padStart(2, "0")).join(""));
    }
    function loadColor(value) {
      const rgb = value.slice(1).match(/../g).map(v => parseInt(v, 16));
      const hsl = window.gZenThemePicker.rgbToHsl(...rgb);
      hue = hsl[0];
      saturation = hsl[1];
      brightness.value = hsl[2] * 100;
      hex.value = value;
      positionDot();
    }
    function openColorEditor(entry) {
      if (activeColor) activeColor.input.setAttribute("aria-expanded", "false");
      activeColor = entry;
      entry.input.setAttribute("aria-expanded", "true");
      editorTitle.textContent = `${entry.label} · ${entry.mode === "light" ? "Light" : "Dark"} mode`;
      editor.hidden = false;
      loadColor(entry.value);
      if (editorWindow && !editorWindow.closed) {
        editorWindow.document.title = editorTitle.textContent;
        editorWindow.focus();
        return;
      }
      const bounds = settings.getBoundingClientRect();
      const left = Math.max(window.screen.availLeft, Math.min(
        window.screenX + bounds.right + 18,
        window.screen.availLeft + window.screen.availWidth - 300));
      const top = Math.max(window.screen.availTop, Math.min(
        window.screenY + bounds.top + 50,
        window.screen.availTop + window.screen.availHeight - 440));
      editorWindow = Services.ww.openWindow(window,
        "chrome://arc-ui/content/features/library/color-editor.xhtml", null,
        `chrome,alwaysontop,dependent,dialog=yes,resizable=no,minimizable=no,width=184,height=350,left=${Math.round(left)},top=${Math.round(top)}`, null);
      const floating = editorWindow;
      floating.addEventListener("load", () => {
        floating.document.title = editorTitle.textContent;
        floating.document.body.append(editor);
        floating.focus();
      }, { once: true });
      floating.addEventListener("unload", () => {
        if (activeColor) activeColor.input.setAttribute("aria-expanded", "false");
        if (editorWindow === floating) editorWindow = null;
      }, { once: true });
    }
    function pick(event) {
      const rect = field.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      hue = (Math.atan2(y, x) * 180 / Math.PI + 450) % 360;
      saturation = Math.min(1, Math.hypot(x, y) / (rect.width * .43));
      saveWheelColor();
    }
    field.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      field.setPointerCapture(event.pointerId);
      pick(event);
    });
    field.addEventListener("pointermove", event => { if (field.hasPointerCapture(event.pointerId)) pick(event); });
    brightness.addEventListener("input", saveWheelColor);
    hex.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { saveColor(hex.value); loadColor(hex.value); } });
    const pickerDone = html("button", "Done");
    pickerDone.type = "button";
    pickerDone.addEventListener("click", () => editorWindow?.close());
    editor.append(editorTitle, pickerHost, brightnessLabel, hexLabel, pickerDone);
    settings.addEventListener("close", () => editorWindow?.close());
    const motionRow = html("label", "");
    motionRow.className = "arc-settings-row";
    motionRow.append(html("span", "Reduce animations"));
    const motion = html("input", "");
    motion.type = "checkbox";
    motion.checked = Services.prefs.getBoolPref(prefBranch + "reduce-motion", false);
    motion.addEventListener("change", () => Services.prefs.setBoolPref(prefBranch + "reduce-motion", motion.checked));
    motionRow.append(motion);
    const reset = html("button", "Reset appearance");
    reset.type = "button";
    reset.addEventListener("click", () => {
      for (const { key, mode } of appearanceInputs) {
        Services.prefs.clearUserPref(prefBranch + mode + "." + key);
      }
      refreshColorInputs();
      if (activeColor) loadColor(activeColor.value);
      Services.prefs.clearUserPref(prefBranch + "reduce-motion");
      motion.checked = false;
    });
    colors.textContent = "Zen workspace colors…";
    note.textContent = "Each palette follows Zen’s light or dark mode across workspaces. Reset restores both palettes and animation defaults.";
    settings.append(motionRow, colors, note, reset, close);
    document.documentElement.append(settings);
    for (const [label, action] of [
      ["GitHub", () => {
        window.openTrustedLinkIn("https://github.com/SpyC0der77/arc-ui-for-zen", "tab");
        void setRail(false).catch(report);
      }],
      ["Settings", () => settings.showModal()],
    ]) {
      const item = document.createXULElement("menuitem");
      item.setAttribute("label", label);
      item.addEventListener("command", action);
      projectMenu.append(item);
    }
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
        "chrome://arc-ui/content/menu-icons/settings.svg",
      );
      github.setAttribute("tooltiptext", "Arc UI menu");
      github.setAttribute("aria-label", "Arc UI menu");
      github.setAttribute("aria-haspopup", "menu");
      github.addEventListener("command", () => {
        projectMenu.openPopup(github, "before_end", 0, 0);
      });
      donate.after(github);
      footerButtons.add(github);
    }
    const footerObserver = new MutationObserver(syncLibraryFooter);
    footerObserver.observe(library, { childList: true, subtree: true });
    syncLibraryFooter();
    const NativeLibrary = library.constructor;
    const content = document.getElementById("zen-appcontent-wrapper");
    const progressDescriptor = Object.getOwnPropertyDescriptor(
      NativeLibrary.prototype, "openProgress",
    );
    const root = document.documentElement;
    const resizeProgress = function (value) {
      progressDescriptor.set.call(this, value);
      if (this !== library) return;
      const transform = content.style.getPropertyValue("transform");
      const match = /^translateX\((-?[\d.]+)px\)$/.exec(transform);
      const offset = value > 0 && match ? Number(match[1]) : 0;
      root.style.setProperty("--arc-library-left", `${Math.max(0, offset)}px`);
      root.style.setProperty("--arc-library-right", `${Math.max(0, -offset)}px`);
      root.toggleAttribute("data-arc-library-resize", value > 0 && !!match);
    };
    if (progressDescriptor?.configurable && progressDescriptor.set) {
      Object.defineProperty(NativeLibrary.prototype, "openProgress", {
        ...progressDescriptor, set: resizeProgress,
      });
    }
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
        if (Object.getOwnPropertyDescriptor(NativeLibrary.prototype, "openProgress")?.set === resizeProgress)
          Object.defineProperty(NativeLibrary.prototype, "openProgress", progressDescriptor);
        root.removeAttribute("data-arc-library-resize");
        root.style.removeProperty("--arc-library-left");
        root.style.removeProperty("--arc-library-right");
        if (NativeLibrary.animateProgress === animateLibrary)
          NativeLibrary.animateProgress = originalLibraryAnimate;
        libraryObserver.disconnect();
        footerObserver.disconnect();
        editorWindow?.close();
        Services.prefs.removeObserver(prefBranch, appearanceObserver);
        for (const [, , variable] of appearance) document.documentElement.style.removeProperty(variable);
        document.documentElement.removeAttribute("data-arc-reduced-motion");
        projectMenu.remove();
        settings.remove();
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
  installLegacy(window, { icon, nudge, hideDownloads, report }) {
    const { document } = window;
    const gift = document.createXULElement("toolbarbutton");
    gift.id = "arc-gift-button";
    gift.className = "toolbarbutton-1 zen-sidebar-action-button arc-icon-button arc-ui";
    gift.setAttribute("aria-label", "Library (hover for downloads)");
    gift.setAttribute("aria-haspopup", "menu");
    gift.setAttribute("aria-expanded", "false");
    gift.setAttribute("aria-pressed", "false");
    gift.append(icon("gift"));
    const popup = document.createXULElement("menupopup");
    popup.id = "arc-legacy-library";
    function addItem(label, action) {
      const item = document.createXULElement("menuitem");
      item.setAttribute("label", label);
      item.addEventListener("command", action);
      popup.append(item);
    }
    function populate() {
      popup.replaceChildren();
      addItem("Downloads", () => window.BrowserCommands.downloadsUI());
      addItem("Bookmarks", () => window.PlacesCommandHook.showPlacesOrganizer("AllBookmarks"));
      addItem("History", () => window.PlacesCommandHook.showPlacesOrganizer("History"));
      popup.append(document.createXULElement("menuseparator"));
      const label = document.createXULElement("menuitem");
      label.setAttribute("label", "Recently closed tabs");
      label.setAttribute("disabled", "true");
      popup.append(label);
      try {
        const { RecentlyClosedTabsAndWindowsMenuUtils } = window.ChromeUtils.importESModule(
          "moz-src:///browser/components/sessionstore/RecentlyClosedTabsAndWindowsMenuUtils.sys.mjs",
        );
        const entries = RecentlyClosedTabsAndWindowsMenuUtils.getTabsFragment(window, "menuitem");
        if (entries.childNodes.length) popup.append(entries);
        else label.setAttribute("label", "No recently closed tabs");
      } catch (error) { report(error); }
    }
    const isOpen = () => popup.state === "open" || popup.state === "showing";
    async function setRail(open) {
      if (open) {
        hideDownloads();
        if (!isOpen()) { populate(); popup.openPopup(gift, "before_start", 0, 0); }
      } else popup.hidePopup();
    }
    popup.addEventListener("popupshown", () => {
      gift.setAttribute("aria-expanded", "true");
      gift.setAttribute("aria-pressed", "true");
    });
    popup.addEventListener("popuphidden", () => {
      gift.setAttribute("aria-expanded", "false");
      gift.setAttribute("aria-pressed", "false");
    });
    gift.addEventListener("command", () => { void setRail(!isOpen()).catch(report); });
    gift.addEventListener("pointerdown", event => { if (event.button === 0) nudge(gift, "gift"); });
    document.getElementById("mainPopupSet").append(popup);
    (document.getElementById("zen-sidebar-foot-buttons") || document.getElementById("navigator-toolbox")).prepend(gift);
    return { gift, setRail, isOpen, destroy() { popup.hidePopup(); popup.remove(); gift.remove(); } };
  },
};
