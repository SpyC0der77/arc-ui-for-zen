/* Library trigger, native opening position, and footer links. Downloads only supply a hide callback. */
var ArcLibrary = {
  colors: [
    ["background", "Background", "--arc-surface", "#cec7d4", "#23202a"],
    ["gradient-end", "Gradient end", "--arc-gradient-end", "#e8dff0", "#493b56"],
    ["foreground", "Foreground text", "--arc-text", "#141414", "#f0edf3"],
    ["accent", "Accent text", "--arc-muted", "#65556f", "#e4d2f5"],
    ["popup", "Menu background", "--arc-popup-surface", "#f6f4f3", "#302c35"],
    ["folder", "Folder icons", "--arc-folder", "#b86ba6", "#d9a3cb"],
    ["tab-active", "Active tab", "--arc-tab-active", "#ffffff", "#655c70"],
    ["tab-hover", "Hover tab", "--arc-tab-hover", "#bcb6c2", "#4c4752"],
    ["hover", "Hover background", "--arc-popup-hover", "#e8e3df", "#413b48"],
    ["pressed", "Pressed background", "--arc-popup-active", "#ded7d2", "#514858"],
  ],
  schema() {
    const fields = [
      { key: "mode", type: "string", fallback: "system", choices: ["light", "dark", "system"] },
      { key: "reduce-motion", type: "boolean", fallback: false },
      { key: "content-radius", type: "number", fallback: 10, min: 0, max: 16 },
    ];
    for (const mode of ["light", "dark"]) {
      for (const [key, , , light, dark] of this.colors)
        fields.push({ key: mode + "." + key, type: "string", color: true, fallback: mode === "dark" ? dark : light });
      fields.push(
        { key: mode + ".gradient", type: "boolean", fallback: false },
        { key: mode + ".gradient-angle", type: "number", fallback: 135, min: 0, max: 360 },
        { key: mode + ".opacity", type: "number", fallback: mode === "dark" ? 88 : 70, min: 0, max: 100 },
      );
    }
    return fields;
  },
  validSetting(field, value) {
    return typeof value === field.type &&
      (!field.color || /^#[0-9a-f]{6}$/i.test(value)) &&
      (!field.choices || field.choices.includes(value)) &&
      (field.type !== "number" || (Number.isInteger(value) && value >= field.min && value <= field.max));
  },
  snapshot(prefs) {
    const values = {};
    for (const field of this.schema()) {
      const read = { string: "getStringPref", boolean: "getBoolPref", number: "getIntPref" }[field.type];
      const value = prefs[read]("arc-ui.appearance." + field.key, field.fallback);
      values[field.key] = this.validSetting(field, value) ? value : field.fallback;
    }
    return values;
  },
  presets(prefs) {
    try {
      const saved = JSON.parse(prefs.getStringPref("arc-ui.appearance.presets", "[]"));
      if (!Array.isArray(saved)) return [];
      const seen = new Set();
      return saved.filter(preset => {
        if (!preset || typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 60 ||
            !preset.values || typeof preset.values !== "object" || Array.isArray(preset.values)) return false;
        const name = preset.name.trim().toLowerCase();
        if (seen.has(name)) return false;
        seen.add(name);
        return true;
      }).slice(0, 20).map(preset => ({ name: preset.name.trim(), values: Object.fromEntries(this.schema().map(field =>
        [field.key, this.validSetting(field, preset.values[field.key]) ? preset.values[field.key] : field.fallback])) }));
    } catch { return []; }
  },
  applyPreset(prefs, values) {
    for (const field of this.schema()) {
      const write = { string: "setStringPref", boolean: "setBoolPref", number: "setIntPref" }[field.type];
      prefs[write]("arc-ui.appearance." + field.key,
        this.validSetting(field, values[field.key]) ? values[field.key] : field.fallback);
    }
  },
  background(prefs, mode) {
    const branch = "arc-ui.appearance." + mode + ".";
    const readColor = (key, fallback) => {
      const value = prefs.getStringPref(branch + key, fallback);
      return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    };
    const start = readColor("background", mode === "dark" ? "#23202a" : "#cec7d4");
    const end = readColor("gradient-end", mode === "dark" ? "#493b56" : "#e8dff0");
    const angle = Math.max(0, Math.min(360, prefs.getIntPref(branch + "gradient-angle", 135)));
    return { start, end, angle, enabled: prefs.getBoolPref(branch + "gradient", false) };
  },
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
    let editorWindow = null;
    const modeInputs = [];
    const gradientInputs = [];
    const rangeInputs = [];
    let refreshPresets = () => {};
    let updateColorReset = () => {};
    let syncModeThumb = () => {};
    let motionInput = null;
    const systemScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const appearance = ArcLibrary.colors;
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
      const savedMode = Services.prefs.getStringPref(prefBranch + "mode", "system");
      const mode = ["light", "dark"].includes(savedMode) ? savedMode : "system";
      const resolved = mode === "system" ? (systemScheme.matches ? "dark" : "light") : mode;
      document.documentElement.setAttribute("data-arc-color-mode", resolved);
      const background = ArcLibrary.background(Services.prefs, resolved);
      document.documentElement.toggleAttribute("data-arc-gradient", background.enabled);
      const { start, end, angle } = background;
      const values = ArcLibrary.snapshot(Services.prefs);
      const opacity = values[resolved + ".opacity"] + "%";
      document.documentElement.style.setProperty("--arc-window-opacity", opacity);
      document.documentElement.style.setProperty("--arc-content-radius", values["content-radius"] + "px");
      for (const { key, input, output, suffix } of rangeInputs) {
        input.value = values[key];
        output.value = values[key] + suffix;
      }
      document.documentElement.style.setProperty("--arc-shell-gradient", `linear-gradient(${angle}deg, ${start}, ${end})`);
      document.documentElement.style.setProperty("--arc-shell-gradient-tint", `linear-gradient(${angle}deg, color-mix(in srgb, ${start} ${opacity}, transparent), color-mix(in srgb, ${end} ${opacity}, transparent))`);
      for (const entry of gradientInputs) {
        const config = ArcLibrary.background(Services.prefs, entry.mode);
        if (entry.key === "gradient") entry.input.checked = config.enabled;
        else {
          entry.input.value = config.angle;
          entry.input.disabled = !config.enabled;
        }
      }
      for (const entry of appearanceInputs) {
        if (entry.key === "gradient-end")
          entry.input.disabled = !ArcLibrary.background(Services.prefs, entry.mode).enabled;
      }
      for (const input of modeInputs) input.checked = input.value === mode;
      syncModeThumb();
      if (editorWindow && !editorWindow.closed)
        editorWindow.document.documentElement.style.setProperty("color-scheme", resolved, "important");
      for (const [key, , variable, lightDefault, darkDefault] of appearance) {
        const values = ["light", "dark"].map((mode, index) => {
          const fallback = index ? darkDefault : lightDefault;
          const value = Services.prefs.getStringPref(prefBranch + mode + "." + key, fallback);
          return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
        });
        document.documentElement.style.setProperty(variable, `light-dark(${values[0]}, ${values[1]})`);
        if (editorWindow && !editorWindow.closed)
          editorWindow.document.documentElement.style.setProperty(variable, `light-dark(${values[0]}, ${values[1]})`);
      }
      const reduceMotion = Services.prefs.getBoolPref(prefBranch + "reduce-motion", false);
      document.documentElement.toggleAttribute("data-arc-reduced-motion", reduceMotion);
      if (motionInput) motionInput.checked = reduceMotion;
      refreshColorInputs();
      refreshPresets();
      updateColorReset();
    }
    const appearanceObserver = { observe: applyAppearance };
    Services.prefs.addObserver(prefBranch, appearanceObserver);
    systemScheme.addEventListener("change", applyAppearance);
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
    const close = html("button", "Done");
    close.type = "button";
    close.addEventListener("click", () => closeSettings());
    // Fade the window out before the real close, matching the entrance.
    function closeSettings() {
      if (!settings.open || settings.dataset.arcClosing) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        settings.close();
        return;
      }
      settings.dataset.arcClosing = "close";
      const finish = () => {
        settings.removeEventListener("animationend", exit);
        clearTimeout(guard);
        delete settings.dataset.arcClosing;
        settings.close();
      };
      // Child animations also bubble here; only the dialog's own exit counts.
      const exit = event => {
        if (event.animationName === "arc-settings-close") finish();
      };
      settings.addEventListener("animationend", exit);
      const guard = setTimeout(finish, 280);
    }
    settings.addEventListener("cancel", event => {
      event.preventDefault();
      closeSettings();
    });
    settings.append(title);
    const modeRow = html("div", "");
    modeRow.className = "arc-settings-row";
    const modeLabel = html("span", "Theme mode");
    modeLabel.id = "arc-appearance-label";
    const modeGroup = html("div", "");
    modeGroup.id = "arc-appearance-mode";
    modeGroup.setAttribute("role", "radiogroup");
    modeGroup.setAttribute("aria-labelledby", modeLabel.id);
    const modeThumb = html("div", "");
    modeThumb.className = "arc-segment-thumb";
    modeGroup.append(modeThumb);
    for (const [value, label] of [["light", "Light"], ["dark", "Dark"], ["system", "System"]]) {
      const segment = html("label", "");
      const input = html("input", "");
      input.type = "radio";
      input.name = "arc-appearance-mode";
      input.value = value;
      input.id = "arc-appearance-" + value;
      input.addEventListener("change", () => {
        if (input.checked) Services.prefs.setStringPref(prefBranch + "mode", value);
      });
      modeInputs.push(input);
      const content = html("span", label);
      content.prepend(icon({ light: "sun", dark: "moon", system: "automatic" }[value]));
      segment.append(input, content);
      modeGroup.append(segment);
    }
    // Measure the selected segment when the dialog is open; hidden dialogs
    // report zero sizes, so opening re-syncs through the Settings action.
    syncModeThumb = () => {
      if (!settings.open) return;
      const label = modeGroup.querySelector("input:checked")?.closest("label");
      if (!label?.offsetWidth) return;
      modeThumb.style.width = `${label.offsetWidth}px`;
      modeThumb.style.transform = `translateX(${label.offsetLeft}px)`;
    };
    syncModeThumb();
    modeRow.append(modeLabel, modeGroup);
    settings.append(modeRow);
    applyAppearance();
    function rangeControl(key, label, min, max, suffix) {
      const row = html("label", "");
      row.className = "arc-settings-row";
      row.dataset.appearanceKey = key;
      row.append(html("span", label));
      const controls = html("div", "");
      controls.className = "arc-range-control";
      const input = html("input", "");
      input.type = "range";
      input.id = "arc-" + key.replaceAll(".", "-");
      input.min = String(min);
      input.max = String(max);
      input.step = "1";
      const output = html("output", "");
      output.setAttribute("for", input.id);
      input.addEventListener("input", () => Services.prefs.setIntPref(prefBranch + key, Number(input.value)));
      rangeInputs.push({ key, input, output, suffix });
      controls.append(input, output);
      row.append(controls);
      return row;
    }
    settings.append(rangeControl("content-radius", "Content corners", 0, 16, " px"));
    const presetDetails = html("section", "");
    presetDetails.id = "arc-theme-presets";
    const presetLabel = html("fieldset", "");
    presetLabel.className = "arc-preset-field";
    const presetLegend = html("legend", "Saved presets");
    const presetGallery = html("div", "");
    presetGallery.id = "arc-preset-gallery";
    const presetEmpty = html("p", "Save your current appearance to create a preset.");
    presetEmpty.id = "arc-preset-empty";
    presetLabel.append(presetLegend, presetGallery, presetEmpty);
    let selectedPresetName = "";
    let renderedPresets = "";
    const presetActions = html("div", "");
    presetActions.className = "arc-preset-actions";
    const apply = html("button", "Apply");
    apply.type = "button";
    apply.id = "arc-preset-apply";
    const remove = html("button", "Delete");
    remove.type = "button";
    remove.id = "arc-preset-delete";
    presetActions.append(apply, remove);
    const nameLabel = html("label", "Preset name");
    nameLabel.className = "arc-preset-field";
    const presetName = html("input", "");
    presetName.id = "arc-preset-name";
    presetName.type = "text";
    presetName.maxLength = 60;
    nameLabel.append(presetName);
    const save = html("button", "Save current appearance");
    save.type = "button";
    save.id = "arc-preset-save";
    const presetStatus = html("p", "");
    presetStatus.id = "arc-preset-status";
    presetStatus.setAttribute("role", "status");
    const previewLabel = html("p", "Current theme");
    previewLabel.id = "arc-preset-preview-label";
    const preview = html("div", "");
    preview.id = "arc-preset-preview";
    preview.className = "arc-theme-preview";
    preview.setAttribute("role", "img");
    const previewRail = html("div", "");
    previewRail.className = "arc-preview-rail";
    const previewToolbar = html("div", "");
    previewToolbar.className = "arc-preview-toolbar";
    for (const name of ["panel", "back", "forward", "reload"]) previewToolbar.append(icon(name));
    const previewAddress = html("div", "Search");
    previewAddress.className = "arc-preview-address";
    previewRail.append(previewToolbar, previewAddress);
    for (const [image, title, active] of [["folder", "Workspace", false], ["file", "New tab", true], ["file", "Settings", false]]) {
      const tab = html("div", "");
      tab.className = "arc-preview-tab";
      if (active) tab.classList.add("arc-preview-active");
      if (image === "folder") tab.classList.add("arc-preview-folder");
      tab.append(icon(image), html("span", title));
      previewRail.append(tab);
    }
    const previewPage = html("div", "");
    previewPage.className = "arc-preview-page";
    const pageTitle = html("span", "New tab");
    pageTitle.className = "arc-preview-page-title";
    const pageSearch = html("span", "Search the web");
    pageSearch.className = "arc-preview-page-search";
    previewPage.append(pageTitle, pageSearch);
    preview.append(previewRail, previewPage);
    function paintPreview(target, values) {
      const mode = values.mode === "system" ? (systemScheme.matches ? "dark" : "light") : values.mode;
      const color = key => values[mode + "." + key];
      target.style.setProperty("--preview-background", values[mode + ".gradient"]
        ? `linear-gradient(${values[mode + ".gradient-angle"]}deg, ${color("background")}, ${color("gradient-end")})` : color("background"));
      for (const key of ["foreground", "accent", "folder", "tab-active"])
        target.style.setProperty("--preview-" + key, color(key));
      target.style.setProperty("--preview-radius", (values["content-radius"] / 10.4) + "cqw");
      target.dataset.mode = mode;
      target.style.setProperty("--preview-opacity", values[mode + ".opacity"] + "%");

      return mode;
    }
    function selectionChanged() {
      apply.disabled = remove.disabled = !selectedPresetName;
    }
    refreshPresets = () => {
      const presets = ArcLibrary.presets(Services.prefs);
      if (!presets.some(item => item.name === selectedPresetName)) selectedPresetName = "";
      const signature = JSON.stringify([presets, systemScheme.matches]);
      if (signature !== renderedPresets) {
        const focusedName = presetGallery.contains(document.activeElement) ? document.activeElement.value : null;
        presetGallery.replaceChildren();
        for (const preset of presets) {
          const choice = html("label", "");
          choice.className = "arc-preset-choice";
          const radio = html("input", "");
          radio.type = "radio";
          radio.name = "arc-saved-preset";
          radio.value = preset.name;
          radio.checked = preset.name === selectedPresetName;
          const thumbnail = preview.cloneNode(true);
          thumbnail.removeAttribute("id");
          thumbnail.removeAttribute("role");
          thumbnail.removeAttribute("aria-label");
          thumbnail.hidden = false;
          thumbnail.classList.add("arc-preset-mini");
          thumbnail.setAttribute("aria-hidden", "true");
          paintPreview(thumbnail, preset.values);
          const caption = html("span", preset.name);
          caption.className = "arc-preset-caption";
          radio.addEventListener("change", () => {
            selectedPresetName = radio.value;
            selectionChanged();
          });
          choice.append(radio, thumbnail, caption);
          presetGallery.append(choice);
          if (focusedName === preset.name) radio.focus({ preventScroll: true });
        }
        renderedPresets = signature;
      }
      for (const radio of presetGallery.querySelectorAll("input")) radio.checked = radio.value === selectedPresetName;
      preview.hidden = previewLabel.hidden = presets.length > 0;
      presetEmpty.hidden = presets.length > 0;
      presetGallery.hidden = !presets.length;
      const mode = paintPreview(preview, ArcLibrary.snapshot(Services.prefs));
      preview.setAttribute("aria-label", `Current theme, ${mode} appearance. Sample browser sidebar and content.`);
      selectionChanged();
    };
    refreshPresets();
    save.addEventListener("click", () => {
      const name = presetName.value.trim();
      const presets = ArcLibrary.presets(Services.prefs);
      if (!name) { presetStatus.textContent = "Enter a name for this preset."; presetName.focus(); return; }
      if (presets.some(preset => preset.name.toLowerCase() === name.toLowerCase())) {
        presetStatus.textContent = "That name is already saved. Choose another name."; return;
      }
      if (presets.length >= 20) { presetStatus.textContent = "You can save up to 20 presets. Delete one to make room."; return; }
      presets.push({ name, values: ArcLibrary.snapshot(Services.prefs) });
      Services.prefs.setStringPref(prefBranch + "presets", JSON.stringify(presets));
      selectedPresetName = name;
      refreshPresets();
      selectionChanged();
      presetName.value = "";
      presetStatus.textContent = `Saved ${name}.`;
    });
    apply.addEventListener("click", () => {
      const preset = ArcLibrary.presets(Services.prefs).find(preset => preset.name === selectedPresetName);
      if (!preset) return;
      ArcLibrary.applyPreset(Services.prefs, preset.values);
      presetStatus.textContent = `Applied ${preset.name}.`;
    });
    remove.addEventListener("click", () => {
      const name = selectedPresetName;
      if (!name) return;
      const presets = ArcLibrary.presets(Services.prefs).filter(preset => preset.name !== name);
      Services.prefs.setStringPref(prefBranch + "presets", JSON.stringify(presets));
      presetStatus.textContent = `Deleted ${name}.`;
    });
    presetDetails.append(previewLabel, preview, presetLabel, presetActions, nameLabel, save, presetStatus);
    settings.append(presetDetails);
    const heading = html("div", "");
    heading.className = "arc-palette-heading";
    heading.append(html("span", "Color"), html("span", "Light"), html("span", "Dark"));
    settings.append(heading);
    let activeColor = null;
    function refreshColorInputs() {
      for (const entry of appearanceInputs) {
        const { input, key, mode, fallback } = entry;
        entry.value = Services.prefs.getStringPref(prefBranch + mode + "." + key, fallback);
        const background = ArcLibrary.background(Services.prefs, mode);
        const preview = key === "background" && background.enabled
          ? `linear-gradient(${background.angle}deg, ${background.start}, ${background.end})` : entry.value;
        input.style.setProperty("--swatch", preview);
        input.title = `${entry.label} · ${mode} · ${entry.value}`;
        input.textContent = "";
      }
    }
    function appendGradientRow(key, label) {
      const row = html("div", "");
      row.className = "arc-settings-row";
      row.dataset.appearanceKey = key;
      row.append(html("span", label));
      const pair = html("div", "");
      pair.className = "arc-gradient-pair";
      for (const mode of ["light", "dark"]) {
        const input = html("input", "");
        input.type = key === "gradient" ? "checkbox" : "number";
        input.id = "arc-" + key + "-" + mode;
        input.setAttribute("aria-label", `${label}, ${mode} mode`);
        if (key !== "gradient") {
          input.min = "0";
          input.max = "360";
          input.step = "1";
          input.title = "Gradient angle in degrees";
        }
        input.addEventListener("change", () => {
          if (key === "gradient") Services.prefs.setBoolPref(prefBranch + mode + "." + key, input.checked);
          else {
            const angle = input.valueAsNumber;
            if (Number.isInteger(angle) && angle >= 0 && angle <= 360)
              Services.prefs.setIntPref(prefBranch + mode + "." + key, angle);
            else input.value = ArcLibrary.background(Services.prefs, mode).angle;
          }
        });
        gradientInputs.push({ input, mode, key });
        if (key === "gradient") pair.append(input);
        else {
          const cell = html("div", "");
          cell.className = "arc-angle-control";
          const slider = html("input", "");
          slider.type = "range";
          slider.id = "arc-gradient-slider-" + mode;
          slider.min = "0";
          slider.max = "360";
          slider.step = "1";
          slider.setAttribute("aria-label", `Gradient angle slider, ${mode} mode`);
          slider.addEventListener("input", () => Services.prefs.setIntPref(prefBranch + mode + ".gradient-angle", Number(slider.value)));
          gradientInputs.push({ input: slider, mode, key });
          cell.append(slider, input);
          pair.append(cell);
        }
      }
      row.append(pair);
      settings.append(row);
    }
    for (const [key, label, , fallback, darkDefault] of appearance) {
      const row = html("div", "");
      row.className = "arc-settings-row arc-color-row";
      row.dataset.appearanceKey = key;
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
      if (key === "background") appendGradientRow("gradient", "Use gradient");
      if (key === "gradient-end") appendGradientRow("gradient-angle", "Gradient angle (°)");
    }
    applyAppearance();
    settings.append(rangeControl("light.opacity", "Light window opacity", 0, 100, "%"));
    settings.append(rangeControl("dark.opacity", "Dark window opacity", 0, 100, "%"));
    applyAppearance();
    refreshColorInputs();
    const editor = html("section", "");
    editor.id = "arc-color-editor";
    editor.hidden = true;
    const editorTitle = html("h3", "");
    editorTitle.title = "Drag to move";
    let editorDrag = null;
    editorTitle.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      const floating = editorTitle.ownerDocument.defaultView;
      editorDrag = { x: event.screenX, y: event.screenY, left: floating.screenX, top: floating.screenY };
      editorTitle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    editorTitle.addEventListener("pointermove", event => {
      if (!editorDrag || !editorTitle.hasPointerCapture(event.pointerId)) return;
      editorTitle.ownerDocument.defaultView.moveTo(
        editorDrag.left + event.screenX - editorDrag.x,
        editorDrag.top + event.screenY - editorDrag.y);
    });
    editorTitle.addEventListener("lostpointercapture", () => { editorDrag = null; });
    editorTitle.addEventListener("pointerup", event => {
      if (editorTitle.hasPointerCapture(event.pointerId)) editorTitle.releasePointerCapture(event.pointerId);
      editorDrag = null;
    });
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
      value = "#" + value.trim().replace(/^#/, "");
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
      updateColorReset();
      entry.input.setAttribute("aria-expanded", "true");
      editorTitle.textContent = `${entry.label} · ${entry.mode === "light" ? "Light" : "Dark"} mode`;
      editor.hidden = false;
      loadColor(entry.value);
      if (editorWindow && !editorWindow.closed) {
        editorWindow.document.title = editorTitle.textContent;
        applyAppearance();
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
        `chrome,titlebar=no,alwaysontop,dependent,dialog=yes,resizable=no,minimizable=no,width=216,height=350,left=${Math.round(left)},top=${Math.round(top)}`, null);
      const floating = editorWindow;
      floating.addEventListener("load", () => {
        floating.document.title = editorTitle.textContent;
        floating.document.querySelector("body").append(editor);
        applyAppearance();
        floating.sizeToContent();
        floating.focus();
        // Register after navigation: the initial about:blank unload is not a close.
        floating.addEventListener("unload", () => {
          if (activeColor) activeColor.input.setAttribute("aria-expanded", "false");
          if (editorWindow === floating) editorWindow = null;
        }, { once: true });
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
    hex.addEventListener("input", () => { if (/^#?[0-9a-f]{6}$/i.test(hex.value.trim())) { saveColor(hex.value); loadColor(hex.value); } });
    const pickerDone = html("button", "Done");
    pickerDone.type = "button";
    pickerDone.addEventListener("click", () => pickerDone.ownerDocument.defaultView.close());
    const colorReset = html("button", "Reset color");
    colorReset.id = "arc-reset-color";
    colorReset.type = "button";
    updateColorReset = () => {
      colorReset.disabled = !activeColor || !Services.prefs.prefHasUserValue(prefBranch + activeColor.mode + "." + activeColor.key);
    };
    colorReset.addEventListener("click", () => {
      if (!activeColor) return;
      Services.prefs.clearUserPref(prefBranch + activeColor.mode + "." + activeColor.key);
      refreshColorInputs();
      loadColor(activeColor.value);
      updateColorReset();
    });
    const pickerActions = html("div", "");
    pickerActions.className = "arc-picker-actions";
    pickerActions.append(colorReset, pickerDone);
    editor.append(editorTitle, pickerHost, brightnessLabel, hexLabel, pickerActions);
    settings.addEventListener("close", () => editorWindow?.close());
    const motionRow = html("label", "");
    motionRow.className = "arc-settings-row";
    motionRow.append(html("span", "Reduce animations"));
    const motion = html("input", "");
    motionInput = motion;
    motion.type = "checkbox";
    motion.checked = Services.prefs.getBoolPref(prefBranch + "reduce-motion", false);
    motion.addEventListener("change", () => Services.prefs.setBoolPref(prefBranch + "reduce-motion", motion.checked));
    motionRow.append(motion);
    const reset = html("button", "Reset appearance");
    reset.type = "button";
    reset.addEventListener("click", () => {
      for (const { key } of ArcLibrary.schema()) Services.prefs.clearUserPref(prefBranch + key);
      refreshColorInputs();
      if (activeColor) loadColor(activeColor.value);
      Services.prefs.clearUserPref(prefBranch + "reduce-motion");
      motion.checked = false;
    });
    const header = html("header", "");
    header.className = "arc-settings-header";
    header.append(title);
    const navigation = html("div", "");
    navigation.className = "arc-settings-tabs";
    navigation.setAttribute("role", "tablist");
    navigation.setAttribute("aria-label", "Settings sections");
    const body = html("div", "");
    body.className = "arc-settings-body";
    const panels = new Map();
    const tabs = [];
    function selectSection(tab, focus = false) {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
        panels.get(item.dataset.section).hidden = !selected;
      }
      settings.dataset.section = tab.dataset.section;
      reset.hidden = tab.dataset.section === 'updates';
      body.scrollTop = 0;
      // A hidden panel reports zero sizes; re-measure when it shows again.
      syncModeThumb();
      editorWindow?.close();
      if (focus) tab.focus();
    }
    for (const [key, label] of [["appearance", "Appearance"], ["colors", "Colors"], ["presets", "Presets"], ["updates", "Updates"]]) {
      const tab = html("button", label);
      tab.type = "button";
      tab.id = "arc-settings-tab-" + key;
      tab.dataset.section = key;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "arc-settings-panel-" + key);
      tab.addEventListener("click", () => selectSection(tab));
      tab.addEventListener("keydown", event => {
        let index = tabs.indexOf(tab);
        if (event.key === "ArrowRight") index = (index + 1) % tabs.length;
        else if (event.key === "ArrowLeft") index = (index + tabs.length - 1) % tabs.length;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = tabs.length - 1;
        else return;
        event.preventDefault();
        selectSection(tabs[index], true);
      });
      const panel = html("section", "");
      panel.id = "arc-settings-panel-" + key;
      panel.className = "arc-settings-panel";
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.tabIndex = 0;
      panels.set(key, panel);
      tabs.push(tab);
      navigation.append(tab);
      body.append(panel);
    }
    // Arc groups related rows into rounded inset cards; headings stay outside.
    function group(...rows) {
      const card = html("div", "");
      card.className = "arc-settings-group";
      card.append(...rows);
      return card;
    }
    const appearancePanel = panels.get("appearance");
    const generalGroup = group(
      modeRow,
      settings.querySelector('[data-appearance-key="content-radius"]'),
      motionRow,
    );
    const backgroundHeading = heading.cloneNode(true);
    backgroundHeading.firstChild.textContent = "Background";
    const backgroundRows = [];
    for (const key of ["background", "gradient", "gradient-end", "gradient-angle"]) {
      const row = settings.querySelector(`[data-appearance-key="${key}"]`);
      if (key === "background") row.firstChild.textContent = "Start color";
      if (key === "gradient-end") row.firstChild.textContent = "End color";
      backgroundRows.push(row);
    }
    const opacityRow = html("div", "");
    opacityRow.className = "arc-settings-row";
    opacityRow.append(html("span", "Window opacity"));
    const opacityPair = html("div", "");
    opacityPair.className = "arc-gradient-pair";
    for (const mode of ["light", "dark"]) {
      const controls = settings.querySelector(`[data-appearance-key="${mode}.opacity"] .arc-range-control`);
      controls.querySelector("input").setAttribute("aria-label", `Window opacity, ${mode} mode`);
      opacityPair.append(controls);
    }
    opacityRow.append(opacityPair);
    const backgroundGroup = group(...backgroundRows, opacityRow);
    appearancePanel.append(generalGroup, backgroundHeading, backgroundGroup);
    const colorsPanel = panels.get("colors");
    colorsPanel.append(heading);
    const colorRows = [];
    for (const [key] of appearance) {
      if (key !== "background" && key !== "gradient-end")
        colorRows.push(settings.querySelector(`[data-appearance-key="${key}"]`));
    }
    colorsPanel.append(group(...colorRows));
    panels.get("presets").append(presetDetails);
    const { ArcUpdater: updater } = window.ChromeUtils.importESModule('chrome://arc-ui/content/updater.sys.mjs');
    const trackRow = html('label', '');
    trackRow.className = 'arc-settings-row';
    trackRow.append(html('span', 'Release track'));
    const track = html('select', '');
    track.id = 'arc-update-track';
    track.disabled = true;
    for (const [value, label] of [['stable', 'Stable'], ['beta', 'Beta']]) {
      const option = html('option', label); option.value = value; track.append(option);
    }
    trackRow.append(track);
    const trackDescription = html('p', 'Stable receives stable releases only. Beta also receives prereleases.');
    trackDescription.id = 'arc-update-track-description';
    track.setAttribute('aria-describedby', trackDescription.id);
    panels.get('updates').append(group(trackRow), trackDescription);
    const syncTrack = () => {
      void updater.getTrack().then(value => {
        track.value = value;
        track.disabled = ['downloading', 'opening'].includes(updater.state);
      }).catch(report);
    };
    track.addEventListener('change', () => {
      try {
        const { PrivateBrowsingUtils } = window.ChromeUtils.importESModule('resource://gre/modules/PrivateBrowsingUtils.sys.mjs');
        updater.setTrack(track.value, { check: !PrivateBrowsingUtils.isWindowPrivate(window) });
      } catch (error) { report(error); syncTrack(); }
    });
    updater.listeners.add(syncTrack);
    syncTrack();
    const footer = html("footer", "");
    footer.className = "arc-settings-footer";
    reset.id = "arc-settings-reset";
    close.id = "arc-settings-done";
    footer.append(reset, close);
    settings.replaceChildren(header, navigation, body, footer);
    selectSection(tabs[0]);
    document.documentElement.append(settings);
    for (const [label, image, action] of [
      ["GitHub", "github", () => {
        window.openTrustedLinkIn("https://github.com/SpyC0der77/arc-ui-for-zen", "tab");
        void setRail(false).catch(report);
      }],
      ["Settings", "settings", () => {
        settings.showModal();
        syncModeThumb();
        requestAnimationFrame(syncModeThumb);
      }],
    ]) {
      const item = document.createXULElement("menuitem");
      item.setAttribute("label", label);
      item.classList.add("menuitem-iconic");
      item.setAttribute("image", `chrome://arc-ui/content/menu-icons/${image}.svg`);
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
        "chrome://arc-ui/content/menu-icons/menu.svg",
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
        systemScheme.removeEventListener("change", applyAppearance);
        document.documentElement.removeAttribute("data-arc-color-mode");
        document.documentElement.removeAttribute("data-arc-gradient");
        document.documentElement.style.removeProperty("--arc-shell-gradient");
        document.documentElement.style.removeProperty("--arc-shell-gradient-tint");
        document.documentElement.style.removeProperty("--arc-window-opacity");
        document.documentElement.style.removeProperty("--arc-content-radius");
        for (const [, , variable] of appearance) document.documentElement.style.removeProperty(variable);
        document.documentElement.removeAttribute("data-arc-reduced-motion");
        projectMenu.remove();
        settings.remove();
        updater.listeners.delete(syncTrack);
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
