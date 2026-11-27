/* Library trigger, native opening position, and footer links. Downloads only supply a hide callback. */
var ZenniaLibrary = {
  colors: [
    ["background", "Background", "--zennia-surface", "#cec7d4", "#23202a"],
    ["gradient-end", "Gradient end", "--zennia-gradient-end", "#e8dff0", "#493b56"],
    ["foreground", "Foreground text", "--zennia-text", "#141414", "#f0edf3"],
    ["accent", "Accent text", "--zennia-muted", "#65556f", "#e4d2f5"],
    ["popup", "Menu background", "--zennia-popup-surface", "#f6f4f3", "#302c35"],
    ["folder", "Folder icons", "--zennia-folder", "#b86ba6", "#d9a3cb"],
    ["tab-active", "Active tab", "--zennia-tab-active", "#ffffff", "#655c70"],
    ["tab-hover", "Hover tab", "--zennia-tab-hover", "#bcb6c2", "#4c4752"],
    ["hover", "Hover background", "--zennia-popup-hover", "#e8e3df", "#413b48"],
    ["pressed", "Pressed background", "--zennia-popup-active", "#ded7d2", "#514858"],
  ],
  /** The browser font recorded in the install receipt, named as the installer names it. */
  fontLabel(receipt) {
    if (receipt?.fontPreset === "geist") return "Geist";
    if (receipt?.fontPreset === "sf-pro") return "SF Pro";
    if (receipt?.fontPreset === "sf-pro-family") return "SF Pro family";
    if (typeof receipt?.customFont === "string" && receipt.customFont)
      return receipt.customFont.replace(/\.(otf|ttf|woff2)$/i, "");
    return "Default";
  },
  schema() {
    const fields = [
      { key: "mode", type: "string", fallback: "system", choices: ["light", "dark", "system"] },
      { key: "reduce-motion", type: "boolean", fallback: false },
      { key: "liquid-glass", type: "boolean", fallback: true },
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
      const value = prefs[read]("zennia.appearance." + field.key, field.fallback);
      values[field.key] = this.validSetting(field, value) ? value : field.fallback;
    }
    return values;
  },
  presets(prefs) {
    try {
      const saved = JSON.parse(prefs.getStringPref("zennia.appearance.presets", "[]"));
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
      prefs[write]("zennia.appearance." + field.key,
        this.validSetting(field, values[field.key]) ? values[field.key] : field.fallback);
    }
  },
  parsePreset(text) {
    if (typeof text !== "string" || text.length > 65536)
      throw new Error("Choose a preset JSON file smaller than 64 KB.");
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("This file is not valid JSON. Choose an exported Zennia preset."); }
    // Presets exported before the rename to Zennia used the "arc-ui-preset" format name.
    if (!data || !["zennia-preset", "arc-ui-preset"].includes(data.format) || data.version !== 1)
      throw new Error("Unsupported preset format or version. Choose a version 1 Zennia preset.");
    if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 60 || /[\u0000-\u001f\u007f]/.test(data.name))
      throw new Error("The preset needs a name of 1 to 60 characters without control characters.");
    const fields = this.schema();
    if (!data.values || typeof data.values !== "object" || Array.isArray(data.values) ||
        Object.keys(data.values).some(key => !fields.some(field => field.key === key)))
      throw new Error("The preset contains unsupported appearance settings.");
    for (const field of fields) {
      if (!Object.hasOwn(data.values, field.key) || !this.validSetting(field, data.values[field.key]))
        throw new Error(`The preset has a missing or invalid setting: ${field.key}.`);
    }
    return { name: data.name.trim(), values: Object.fromEntries(fields.map(field => [field.key, data.values[field.key]])) };
  },
  exportPreset(preset) {
    const text = JSON.stringify({ format: "zennia-preset", version: 1, name: preset.name, values: preset.values }, null, 2) + "\n";
    this.parsePreset(text);
    return text;
  },
  importPreset(prefs, text) {
    const preset = this.parsePreset(text);
    const presets = this.presets(prefs);
    if (presets.length >= 20) throw new Error("You can save up to 20 presets. Delete one to make room.");
    const original = preset.name;
    for (let suffix = 2; presets.some(item => item.name.toLowerCase() === preset.name.toLowerCase()); suffix++) {
      const ending = ` (${suffix})`;
      preset.name = original.slice(0, 60 - ending.length).trimEnd() + ending;
    }
    presets.push(preset);
    prefs.setStringPref("zennia.appearance.presets", JSON.stringify(presets));
    return preset;
  },
  background(prefs, mode) {
    const branch = "zennia.appearance." + mode + ".";
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
    const { icon, nudge, hideDownloads, report, zen, liquidGlass } = dependencies;
    const toolbox = document.getElementById("navigator-toolbox");
    const library = document.querySelector(zen.name("zen-library"));
    // Zen versions without the native library (features.library "menu") get a menu instead.
    if (zen.features.library !== "native" || !library)
      return this.installLegacy(window, dependencies);
    const footerButtons = new Set();
    const { Services } = window;
    const prefBranch = "zennia.appearance.";
    const appearanceInputs = [];
    let editorWindow = null;
    let settingsWindow = null;
    const modeInputs = [];
    const gradientInputs = [];
    const rangeInputs = [];
    let refreshPresets = () => {};
    let updateColorReset = () => {};
    let syncModeThumb = () => {};
    let resetEditMode = () => {};
    let motionInput = null;
    let glassInput = null;
    let applyGlass = () => {};
    const systemScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const appearance = ZenniaLibrary.colors;
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
      document.documentElement.setAttribute("data-zennia-color-mode", resolved);
      const background = ZenniaLibrary.background(Services.prefs, resolved);
      document.documentElement.toggleAttribute("data-zennia-gradient", background.enabled);
      const { start, end, angle } = background;
      const values = ZenniaLibrary.snapshot(Services.prefs);
      const opacity = values[resolved + ".opacity"] + "%";
      document.documentElement.style.setProperty("--zennia-window-opacity", opacity);
      document.documentElement.style.setProperty("--zennia-content-radius", values["content-radius"] + "px");
      for (const { key, input, output, suffix } of rangeInputs) {
        input.value = values[key];
        output.value = values[key] + suffix;
      }
      document.documentElement.style.setProperty("--zennia-shell-gradient", `linear-gradient(${angle}deg, ${start}, ${end})`);
      document.documentElement.style.setProperty("--zennia-shell-gradient-tint", `linear-gradient(${angle}deg, color-mix(in srgb, ${start} ${opacity}, transparent), color-mix(in srgb, ${end} ${opacity}, transparent))`);
      for (const entry of gradientInputs) {
        const config = ZenniaLibrary.background(Services.prefs, entry.mode);
        if (entry.key === "gradient") entry.input.checked = config.enabled;
        else {
          entry.input.value = config.angle;
          entry.input.disabled = !config.enabled;
        }
      }
      for (const entry of appearanceInputs) {
        if (entry.key === "gradient-end")
          entry.input.disabled = !ZenniaLibrary.background(Services.prefs, entry.mode).enabled;
      }
      for (const input of modeInputs) input.checked = input.value === mode;
      syncModeThumb();
      if (editorWindow && !editorWindow.closed)
        editorWindow.document.documentElement.style.setProperty("color-scheme", resolved, "important");
      if (settingsWindow && !settingsWindow.closed)
        settingsWindow.document.documentElement.style.setProperty("color-scheme", resolved, "important");
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
      document.documentElement.toggleAttribute("data-zennia-reduced-motion", reduceMotion);
      settingsWindow?.document?.getElementById("zennia-settings-dialog")?.toggleAttribute("data-zennia-reduced-motion", reduceMotion);
      if (motionInput) motionInput.checked = reduceMotion;
      const glass = Services.prefs.getBoolPref(prefBranch + "liquid-glass", true);
      if (glassInput) glassInput.checked = glass;
      applyGlass(glass, resolved);
      refreshColorInputs();
      refreshPresets();
      updateColorReset();
    }
    const appearanceObserver = { observe: applyAppearance };
    Services.prefs.addObserver(prefBranch, appearanceObserver);
    systemScheme.addEventListener("change", applyAppearance);
    applyAppearance();
    const projectMenu = document.createXULElement("menupopup");
    projectMenu.id = "zennia-project-menu";
    projectMenu.setAttribute("nonnative", "true");
    document.getElementById("mainPopupSet").append(projectMenu);
    const settings = document.createElementNS("http://www.w3.org/1999/xhtml", "dialog");
    settings.id = "zennia-settings-dialog";
    settings.setAttribute("aria-labelledby", "zennia-settings-title");
    function html(tag, text) {
      const node = document.createElementNS("http://www.w3.org/1999/xhtml", tag);
      node.textContent = text;
      return node;
    }
    const title = html("h2", "Zennia settings");
    title.id = "zennia-settings-title";
    // Settings live in a real OS window (settings.xhtml), so the system draws
    // the title bar, close button and dragging. Closing means closing it.
    function closeSettings() {
      if (settingsWindow && !settingsWindow.closed) settingsWindow.close();
    }
    settings.addEventListener("cancel", event => {
      event.preventDefault();
      closeSettings();
    });
    settings.append(title);
    const modeRow = html("div", "");
    modeRow.className = "zennia-settings-row";
    const modeLabel = html("span", "Theme mode");
    modeLabel.id = "zennia-appearance-label";
    const modeGroup = html("div", "");
    modeGroup.id = "zennia-appearance-mode";
    modeGroup.className = "zennia-segmented";
    modeGroup.setAttribute("role", "radiogroup");
    modeGroup.setAttribute("aria-labelledby", modeLabel.id);
    const modeThumb = html("div", "");
    modeThumb.className = "zennia-segment-thumb";
    modeGroup.append(modeThumb);
    function addSegment(group, name, value, label, onSelect) {
      const segment = html("label", "");
      const input = html("input", "");
      input.type = "radio";
      input.name = name;
      input.value = value;
      input.addEventListener("change", () => {
        if (input.checked) onSelect(value);
      });
      const content = html("span", label);
      content.prepend(icon({ light: "sun", dark: "moon", system: "automatic" }[value]));
      segment.append(input, content);
      group.append(segment);
      return input;
    }
    for (const [value, label] of [["light", "Light"], ["dark", "Dark"], ["system", "System"]]) {
      const input = addSegment(modeGroup, modeGroup.id, value, label,
        next => Services.prefs.setStringPref(prefBranch + "mode", next));
      input.id = "zennia-appearance-" + value;
      modeInputs.push(input);
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
      row.className = "zennia-settings-row";
      row.dataset.appearanceKey = key;
      row.append(html("span", label));
      const controls = html("div", "");
      controls.className = "zennia-range-control";
      const input = html("input", "");
      input.type = "range";
      input.id = "zennia-" + key.replaceAll(".", "-");
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
    presetDetails.id = "zennia-theme-presets";
    const presetLabel = html("fieldset", "");
    presetLabel.className = "zennia-preset-field";
    const presetLegend = html("legend", "Saved presets");
    const presetGallery = html("div", "");
    presetGallery.id = "zennia-preset-gallery";
    const presetEmpty = html("p", "Save your current appearance to create a preset.");
    presetEmpty.id = "zennia-preset-empty";
    presetLabel.append(presetLegend, presetGallery, presetEmpty);
    let selectedPresetName = "";
    let renderedPresets = "";
    const presetActions = html("div", "");
    presetActions.className = "zennia-preset-actions";
    const apply = html("button", "Apply");
    apply.type = "button";
    apply.id = "zennia-preset-apply";
    const remove = html("button", "Delete");
    remove.type = "button";
    remove.id = "zennia-preset-delete";
    const exportButton = html("button", "Export…");
    exportButton.type = "button";
    exportButton.id = "zennia-preset-export";
    const importButton = html("button", "Import…");
    importButton.type = "button";
    importButton.id = "zennia-preset-import";
    presetActions.append(apply, remove, exportButton, importButton);
    const nameLabel = html("label", "Preset name");
    nameLabel.className = "zennia-preset-field";
    const presetName = html("input", "");
    presetName.id = "zennia-preset-name";
    presetName.type = "text";
    presetName.maxLength = 60;
    nameLabel.append(presetName);
    const save = html("button", "Save current appearance");
    save.type = "button";
    save.id = "zennia-preset-save";
    const presetStatus = html("p", "");
    presetStatus.id = "zennia-preset-status";
    presetStatus.setAttribute("role", "status");
    const previewLabel = html("p", "Current theme");
    previewLabel.id = "zennia-preset-preview-label";
    const preview = html("div", "");
    preview.id = "zennia-preset-preview";
    preview.className = "zennia-theme-preview";
    preview.setAttribute("role", "img");
    const previewRail = html("div", "");
    previewRail.className = "zennia-preview-rail";
    const previewToolbar = html("div", "");
    previewToolbar.className = "zennia-preview-toolbar";
    for (const name of ["panel"]) previewToolbar.append(icon(name));
    const previewAddress = html("div", "Search...");
    previewAddress.className = "zennia-preview-address";
    previewRail.append(previewToolbar, previewAddress);
    for (const [image, title, active] of [["folder", "Space", false], ["folder", "Pull Requests", false], ["folder", "Issues", false], ["file", "New Tab", false], ["file", "New Tab", true]]) {
      const tab = html("div", "");
      tab.className = "zennia-preview-tab";
      if (active) tab.classList.add("zennia-preview-active");
      if (image === "folder") tab.classList.add("zennia-preview-folder");
      tab.append(icon(image), html("span", title));
      previewRail.append(tab);
    }
    const previewPage = html("div", "");
    previewPage.className = "zennia-preview-page";
    const previewFooter = html("div", "");
    previewFooter.className = "zennia-preview-footer";
    previewFooter.append(icon("gift"), html("span", "+"));
    previewRail.append(previewFooter);
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
      apply.disabled = remove.disabled = exportButton.disabled = !selectedPresetName;
    }
    refreshPresets = () => {
      const presets = ZenniaLibrary.presets(Services.prefs);
      if (!presets.some(item => item.name === selectedPresetName)) selectedPresetName = "";
      const signature = JSON.stringify([presets, systemScheme.matches]);
      if (signature !== renderedPresets) {
        const active = settings.ownerDocument.activeElement;
        const focusedName = presetGallery.contains(active) ? active.value : null;
        presetGallery.replaceChildren();
        for (const preset of presets) {
          const choice = html("label", "");
          choice.className = "zennia-preset-choice";
          const radio = html("input", "");
          radio.type = "radio";
          radio.name = "zennia-saved-preset";
          radio.value = preset.name;
          radio.checked = preset.name === selectedPresetName;
          const thumbnail = preview.cloneNode(true);
          thumbnail.removeAttribute("id");
          thumbnail.removeAttribute("role");
          thumbnail.removeAttribute("aria-label");
          thumbnail.hidden = false;
          thumbnail.classList.add("zennia-preset-mini");
          thumbnail.setAttribute("aria-hidden", "true");
          paintPreview(thumbnail, preset.values);
          const caption = html("span", preset.name);
          caption.className = "zennia-preset-caption";
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
      const mode = paintPreview(preview, ZenniaLibrary.snapshot(Services.prefs));
      preview.setAttribute("aria-label", `Current theme, ${mode} appearance. Sample browser sidebar and content.`);
      selectionChanged();
    };
    refreshPresets();
    save.addEventListener("click", () => {
      const name = presetName.value.trim();
      const presets = ZenniaLibrary.presets(Services.prefs);
      if (!name) { presetStatus.textContent = "Enter a name for this preset."; presetName.focus(); return; }
      if (presets.some(preset => preset.name.toLowerCase() === name.toLowerCase())) {
        presetStatus.textContent = "That name is already saved. Choose another name."; return;
      }
      if (presets.length >= 20) { presetStatus.textContent = "You can save up to 20 presets. Delete one to make room."; return; }
      presets.push({ name, values: ZenniaLibrary.snapshot(Services.prefs) });
      Services.prefs.setStringPref(prefBranch + "presets", JSON.stringify(presets));
      selectedPresetName = name;
      refreshPresets();
      selectionChanged();
      presetName.value = "";
      presetStatus.textContent = `Saved ${name}.`;
    });
    apply.addEventListener("click", () => {
      const preset = ZenniaLibrary.presets(Services.prefs).find(preset => preset.name === selectedPresetName);
      if (!preset) return;
      ZenniaLibrary.applyPreset(Services.prefs, preset.values);
      presetStatus.textContent = `Applied ${preset.name}.`;
    });
    remove.addEventListener("click", () => {
      const name = selectedPresetName;
      if (!name) return;
      const presets = ZenniaLibrary.presets(Services.prefs).filter(preset => preset.name !== name);
      Services.prefs.setStringPref(prefBranch + "presets", JSON.stringify(presets));
      presetStatus.textContent = `Deleted ${name}.`;
    });
    let fileBusy = false;
    async function transferPreset(exporting) {
      if (fileBusy) return;
      const preset = ZenniaLibrary.presets(Services.prefs).find(item => item.name === selectedPresetName);
      if (exporting && !preset) return;
      fileBusy = true;
      importButton.disabled = exportButton.disabled = true;
      presetStatus.textContent = "";
      try {
        const { Cc, Ci, IOUtils } = window;
        const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
        picker.init(settings.ownerDocument.defaultView.browsingContext, exporting ? "Export preset" : "Import preset",
          exporting ? Ci.nsIFilePicker.modeSave : Ci.nsIFilePicker.modeOpen);
        picker.appendFilter("Zennia preset (*.json)", "*.json");
        picker.defaultExtension = "json";
        if (exporting) picker.defaultString = (preset.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "zennia-preset") + ".json";
        const result = await new Promise(resolve => picker.open(resolve));
        if (result === Ci.nsIFilePicker.returnCancel || !picker.file) return;
        if (exporting) {
          await IOUtils.writeUTF8(picker.file.path, ZenniaLibrary.exportPreset(preset));
          presetStatus.textContent = `Exported ${preset.name}.`;
        } else {
          if ((await IOUtils.stat(picker.file.path)).size > 65536)
            throw new Error("Choose a preset JSON file smaller than 64 KB.");
          const imported = ZenniaLibrary.importPreset(Services.prefs, await IOUtils.readUTF8(picker.file.path));
          selectedPresetName = imported.name;
          refreshPresets();
          presetStatus.textContent = `Imported ${imported.name}. Preview it above, then choose Apply to use it.`;
          presetGallery.querySelector("input:checked")?.focus({ preventScroll: true });
          presetActions.scrollIntoView({ block: "nearest" });
        }
      } catch (error) {
        presetStatus.textContent = `${exporting ? "Export" : "Import"} failed. ${error.message}`;
      } finally {
        fileBusy = false;
        importButton.disabled = false;
        selectionChanged();
      }
    }
    exportButton.addEventListener("click", () => void transferPreset(true));
    importButton.addEventListener("click", () => void transferPreset(false));
    presetDetails.append(previewLabel, preview, presetLabel, presetActions, nameLabel, save, presetStatus);
    settings.append(presetDetails);
    const heading = html("div", "");
    heading.className = "zennia-palette-heading";
    heading.append(html("span", "Color"), html("span", "Light"), html("span", "Dark"));
    settings.append(heading);
    let activeColor = null;
    function refreshColorInputs() {
      for (const entry of appearanceInputs) {
        const { input, key, mode, fallback } = entry;
        entry.value = Services.prefs.getStringPref(prefBranch + mode + "." + key, fallback);
        const background = ZenniaLibrary.background(Services.prefs, mode);
        const preview = key === "background" && background.enabled
          ? `linear-gradient(${background.angle}deg, ${background.start}, ${background.end})` : entry.value;
        input.style.setProperty("--swatch", preview);
        input.title = `${entry.label} · ${mode} · ${entry.value}`;
        input.textContent = "";
      }
    }
    function appendGradientRow(key, label) {
      const row = html("div", "");
      row.className = "zennia-settings-row";
      row.dataset.appearanceKey = key;
      row.append(html("span", label));
      const pair = html("div", "");
      pair.className = "zennia-gradient-pair";
      for (const mode of ["light", "dark"]) {
        const input = html("input", "");
        input.type = key === "gradient" ? "checkbox" : "number";
        input.id = "zennia-" + key + "-" + mode;
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
            else input.value = ZenniaLibrary.background(Services.prefs, mode).angle;
          }
        });
        gradientInputs.push({ input, mode, key });
        if (key === "gradient") pair.append(input);
        else {
          const cell = html("div", "");
          cell.className = "zennia-angle-control";
          const slider = html("input", "");
          slider.type = "range";
          slider.id = "zennia-gradient-slider-" + mode;
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
      row.className = "zennia-settings-row zennia-color-row";
      row.dataset.appearanceKey = key;
      row.append(html("span", label));
      const pair = html("div", "");
      pair.className = "zennia-color-pair";
      for (const mode of ["light", "dark"]) {
        const input = html("button", "");
        input.type = "button";
        input.className = "zennia-color-swatch";
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
    editor.id = "zennia-color-editor";
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
    pickerStyles.href = zen.url("chrome://browser/content/zen-styles/zen-boosts.css");
    const field = html("div", "");
    field.className = zen.name("zen-boost-color-picker-gradient");
    // Keep the native Boosts inset, translucent veil, dotted texture and
    // blurred spectrum. Overriding these with a radial gradient exposes the
    // saturated conic layer and loses the native picker appearance.
    field.style.cssText = zen.name("width:152px;height:152px;min-height:0;margin:0 auto;touch-action:none;--zen-boosts-color-picker-background:light-dark(#fbfbfdea,#1c1c1eea);--zen-boosts-color-picker-pattern-color:light-dark(#e3e9e4,#3a3a3a)");
    const dot = html("div", "");
    dot.className = zen.name("zen-boost-color-picker-dot");
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
      dot.style.setProperty(zen.name("--zen-theme-picker-dot-color"), hex.value);
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
      const host = settings.ownerDocument.defaultView;
      const bounds = settings.getBoundingClientRect();
      const left = Math.max(host.screen.availLeft, Math.min(
        host.mozInnerScreenX + bounds.right + 18,
        host.screen.availLeft + host.screen.availWidth - 300));
      const top = Math.max(host.screen.availTop, Math.min(
        host.mozInnerScreenY + bounds.top + 50,
        host.screen.availTop + host.screen.availHeight - 440));
      editorWindow = Services.ww.openWindow(host,
        "chrome://zennia/content/features/library/color-editor.xhtml", null,
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
    colorReset.id = "zennia-reset-color";
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
    pickerActions.className = "zennia-picker-actions";
    pickerActions.append(colorReset, pickerDone);
    editor.append(editorTitle, pickerHost, brightnessLabel, hexLabel, pickerActions);
    settings.addEventListener("close", () => editorWindow?.close());
    const motionRow = html("label", "");
    motionRow.className = "zennia-settings-row";
    motionRow.append(html("span", "Reduce animations"));
    const motion = html("input", "");
    motionInput = motion;
    motion.type = "checkbox";
    motion.checked = Services.prefs.getBoolPref(prefBranch + "reduce-motion", false);
    motion.addEventListener("change", () => Services.prefs.setBoolPref(prefBranch + "reduce-motion", motion.checked));
    motionRow.append(motion);
    // Liquid Glass controls in this window, on by default (settings.css).
    const glassRow = html("label", "");
    glassRow.className = "zennia-settings-row";
    glassRow.append(html("span", "Liquid Glass"));
    const glassToggle = html("input", "");
    glassInput = glassToggle;
    glassToggle.type = "checkbox";
    glassToggle.checked = Services.prefs.getBoolPref(prefBranch + "liquid-glass", true);
    glassToggle.addEventListener("change", () => Services.prefs.setBoolPref(prefBranch + "liquid-glass", glassToggle.checked));
    glassRow.append(glassToggle);
    // The browser font is chosen in the installer; its receipt in the profile records it.
    const fontRow = html("div", "");
    fontRow.className = "zennia-settings-row";
    const fontValue = html("output", "Default");
    fontValue.id = "zennia-browser-font";
    fontRow.append(html("span", "Browser font"), fontValue);
    async function refreshFont() {
      try {
        const receipt = await window.IOUtils.readJSON(window.PathUtils.join(window.PathUtils.profileDir, "chrome", "zennia.install.json"));
        fontValue.textContent = ZenniaLibrary.fontLabel(receipt);
      } catch {
        fontValue.textContent = ZenniaLibrary.fontLabel(null);
      }
    }
    // The native controls keep their CSS appearance when the glass renderer is unavailable.
    const reducedMotion = () => document.documentElement.hasAttribute("data-zennia-reduced-motion") ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reducedTransparency = window.matchMedia("(prefers-reduced-transparency: reduce)");
    let glassKit = null;
    try {
      glassKit = liquidGlass?.install(window, { reduced: reducedMotion }) ?? null;
    } catch (error) {
      report?.(error);
    }
    const glassOn = () => settings.hasAttribute("data-zennia-glass") && !reducedTransparency.matches;
    applyGlass = (enabled, mode) => {
      if (settings.hasAttribute("data-zennia-glass") !== enabled) closeSelectMenus(true);
      settings.toggleAttribute("data-zennia-glass", enabled);
      glassKit?.sync(glassOn(), mode);
    };
    const onTransparencyChange = () => {
      closeSelectMenus(true);
      glassKit?.sync(glassOn());
    };
    reducedTransparency.addEventListener("change", onTransparencyChange);
    const reset = html("button", "Reset appearance");
    reset.type = "button";
    reset.addEventListener("click", () => {
      for (const { key } of ZenniaLibrary.schema()) Services.prefs.clearUserPref(prefBranch + key);
      refreshColorInputs();
      if (activeColor) loadColor(activeColor.value);
      Services.prefs.clearUserPref(prefBranch + "reduce-motion");
      motion.checked = false;
    });
    const header = html("header", "");
    header.className = "zennia-settings-header";
    header.append(title);
    const navigation = html("div", "");
    navigation.className = "zennia-settings-tabs";
    navigation.setAttribute("role", "tablist");
    navigation.setAttribute("aria-label", "Settings sections");
    const body = html("div", "");
    body.className = "zennia-settings-body";
    const panels = new Map();
    const tabs = [];
    const selectMenus = [];
    function closeSelectMenus(immediate = false) {
      for (const { menu, hide } of selectMenus) if (menu.matches(":popover-open")) hide(immediate);
    }
    function selectSection(tab, focus = false) {
      closeSelectMenus(true);
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.tabIndex = selected ? 0 : -1;
        // Opening the window focuses the current section.
        item.toggleAttribute("autofocus", selected);
        panels.get(item.dataset.section).hidden = !selected;
      }
      settings.dataset.section = tab.dataset.section;
      title.textContent = tab.dataset.label;
      if (settingsWindow && !settingsWindow.closed) settingsWindow.document.title = tab.dataset.label;
      reset.hidden = tab.dataset.section === 'updates';
      body.scrollTop = 0;
      // A hidden panel reports zero sizes; re-measure when it shows again.
      syncModeThumb();
      editorWindow?.close();
      if (focus) tab.focus();
    }
    for (const [key, label, image] of [["appearance", "Appearance", "sliders"], ["colors", "Colors", "palette"], ["presets", "Presets", "layers"], ["updates", "Updates", "download"]]) {
      const tab = html("button", "");
      tab.append(icon(image), html("span", label));
      tab.type = "button";
      tab.id = "zennia-settings-tab-" + key;
      tab.dataset.section = key;
      tab.dataset.label = label;
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-controls", "zennia-settings-panel-" + key);
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
      panel.id = "zennia-settings-panel-" + key;
      panel.className = "zennia-settings-panel";
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", tab.id);
      panel.tabIndex = 0;
      panels.set(key, panel);
      tabs.push(tab);
      navigation.append(tab);
      body.append(panel);
    }
    // Rows read like Arc's settings list: a title with a quieter description.
    function describe(row, text) {
      const label = row.firstElementChild;
      const copy = html("div", "");
      copy.className = "zennia-row-text";
      const note = html("small", text);
      label.before(copy);
      copy.append(label, note);
      return row;
    }
    // Arc groups related rows into one bordered list; headings stay outside.
    function group(...rows) {
      const card = html("div", "");
      card.className = "zennia-settings-group";
      card.append(...rows);
      return card;
    }
    const appearancePanel = panels.get("appearance");
    const generalGroup = group(
      describe(modeRow, "Follow your system, or keep Zen light or dark."),
      describe(settings.querySelector('[data-appearance-key="content-radius"]'), "Rounding of the frame around web pages."),
      describe(motionRow, "Skip motion in the sidebar, menus and dialogs."),
      describe(glassRow, "Glass switches, sliders and segmented controls in this window."),
      describe(fontRow, "Chosen in the Zennia installer. Install again to change it."),
    );
    // Edit one appearance at a time: each list heading carries a Light/Dark
    // switch, and the rows show only that mode's control.
    const editSwitches = [];
    function setEditMode(mode) {
      settings.dataset.editMode = mode;
      for (const input of editSwitches) input.checked = input.value === mode;
      glassKit?.sync();
    }
    function editHeading(text) {
      const row = html("div", "");
      row.className = "zennia-palette-heading";
      const switcher = html("div", "");
      switcher.className = "zennia-segmented zennia-edit-mode";
      switcher.setAttribute("role", "radiogroup");
      switcher.setAttribute("aria-label", `${text}: appearance to edit`);
      const name = "zennia-edit-" + text.toLowerCase();
      for (const [value, label] of [["light", "Light"], ["dark", "Dark"]]) {
        editSwitches.push(addSegment(switcher, name, value, label, setEditMode));
      }
      row.append(html("span", text), switcher);
      return row;
    }
    resetEditMode = () => {
      const mode = Services.prefs.getStringPref(prefBranch + "mode", "system");
      setEditMode(mode === "system" ? (systemScheme.matches ? "dark" : "light") : mode);
    };
    const backgroundHeading = editHeading("Background");
    const backgroundRows = [];
    for (const key of ["background", "gradient", "gradient-end", "gradient-angle"]) {
      const row = settings.querySelector(`[data-appearance-key="${key}"]`);
      if (key === "background") row.firstChild.textContent = "Start color";
      if (key === "gradient-end") row.firstChild.textContent = "End color";
      if (key === "gradient") describe(row, "Blend the window from the start color to the end color.");
      backgroundRows.push(row);
    }
    const opacityRow = html("div", "");
    opacityRow.className = "zennia-settings-row";
    opacityRow.append(html("span", "Window opacity"));
    const opacityPair = html("div", "");
    opacityPair.className = "zennia-gradient-pair";
    for (const mode of ["light", "dark"]) {
      const controls = settings.querySelector(`[data-appearance-key="${mode}.opacity"] .zennia-range-control`);
      controls.querySelector("input").setAttribute("aria-label", `Window opacity, ${mode} mode`);
      opacityPair.append(controls);
    }
    opacityRow.append(opacityPair);
    describe(opacityRow, "Let your desktop show through the window.");
    const backgroundGroup = group(...backgroundRows, opacityRow);
    appearancePanel.append(generalGroup, backgroundHeading, backgroundGroup);
    const colorsPanel = panels.get("colors");
    colorsPanel.append(editHeading("Colors"));
    resetEditMode();
    const colorRows = [];
    const colorNotes = {
      foreground: "Tab titles, labels and menu text.",
      accent: "Secondary labels and highlights.",
      popup: "Menus, popups and this window's lists.",
      folder: "Folder icons in the sidebar.",
      "tab-active": "The selected tab.",
      "tab-hover": "Tabs under the pointer.",
      hover: "Menu rows under the pointer.",
      pressed: "Menu rows while pressed.",
    };
    for (const [key] of appearance) {
      if (key !== "background" && key !== "gradient-end")
        colorRows.push(describe(settings.querySelector(`[data-appearance-key="${key}"]`), colorNotes[key] || ""));
    }
    colorsPanel.append(group(...colorRows));
    // Presets read as two cards: the gallery with its actions, then saving.
    const presetSaveHeading = html("h4", "Save current appearance");
    presetSaveHeading.className = "zennia-settings-section";
    const presetSaveRow = html("div", "");
    presetSaveRow.className = "zennia-preset-save-row";
    save.textContent = "Save";
    presetName.placeholder = "Preset name";
    presetName.setAttribute("aria-label", "Preset name");
    presetSaveRow.append(presetName, save);
    presetDetails.replaceChildren(
      group(previewLabel, preview, presetLabel, presetActions),
      presetSaveHeading,
      group(presetSaveRow),
      presetStatus,
    );
    panels.get("presets").append(presetDetails);
    const { ZenniaUpdater: updater } = window.ChromeUtils.importESModule('chrome://zennia/content/updater.sys.mjs');
    const trackRow = html('label', '');
    trackRow.className = 'zennia-settings-row';
    trackRow.append(html('span', 'Release track'));
    const track = html('select', '');
    track.id = 'zennia-update-track';
    track.disabled = true;
    for (const [value, label] of [['stable', 'Stable'], ['beta', 'Beta']]) {
      const option = html('option', label); option.value = value; track.append(option);
    }
    trackRow.append(track);
    const trackDescription = html('p', 'Stable receives stable releases only. Beta also receives prereleases.');
    trackDescription.id = 'zennia-update-track-description';
    track.setAttribute('aria-describedby', trackDescription.id);
    trackDescription.remove();
    const trackNote = html("small", trackDescription.textContent);
    trackNote.id = trackDescription.id;
    const trackCopy = html("div", "");
    trackCopy.className = "zennia-row-text";
    trackCopy.append(trackRow.firstElementChild, trackNote);
    trackRow.prepend(trackCopy);
    // Reinstall and Uninstall ask first, then hand Zen to the updater, which closes or restarts it.
    const removals = [];
    function removalRow(title, note, label, question, failure, run) {
      const copy = html("div", "");
      copy.className = "zennia-row-text";
      copy.append(html("span", title), html("small", note));
      const button = html("button", label);
      button.type = "button";
      button.addEventListener("click", async () => {
        const view = settings.ownerDocument.defaultView;
        if (!Services.prompt.confirm(view, `${title}?`, question)) return;
        try {
          await run();
        } catch (error) {
          Services.prompt.alert(view, failure, error.message);
        }
      });
      const row = html("div", "");
      row.className = "zennia-settings-row";
      row.append(copy, button);
      removals.push({ button, label });
      return row;
    }
    const reinstallRow = removalRow("Reinstall Zennia",
      "Remove the theme and open its installer to install it again. Zen closes.",
      "Reinstall",
      "Zennia's installer will be downloaded, Zennia will be removed, and Zen will close so the installer can install it again. Your tabs, bookmarks and history stay.",
      "Could not reinstall Zennia", () => updater.reinstall());
    const uninstallRow = removalRow("Uninstall Zennia",
      "Remove the theme and restart Zen. Your tabs, bookmarks and history stay.",
      "Uninstall",
      "Zennia will be removed from this Zen installation, and Zen will restart. Your tabs, bookmarks and history stay.",
      "Could not uninstall Zennia", () => updater.uninstall());
    const syncRemoval = () => {
      const busy = updater.state === "removing";
      for (const { button, label } of removals) button.disabled = busy;
      const [reinstall] = removals;
      reinstall.button.textContent = busy && updater.progress !== null ? `Downloading ${Math.round(updater.progress)}%` : reinstall.label;
    };
    updater.listeners.add(syncRemoval);
    panels.get("updates").append(group(trackRow), group(reinstallRow, uninstallRow));
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
    footer.className = "zennia-settings-footer";
    reset.id = "zennia-settings-reset";
    footer.append(reset);
    // Reset scrolls with the settings list, as the last item under it.
    body.append(footer);
    settings.replaceChildren(header, navigation, body);
    selectSection(tabs[0]);
    document.documentElement.append(settings);
    for (const input of settings.querySelectorAll('input[type="range"]')) glassKit?.slider(input);
    for (const group of settings.querySelectorAll(".zennia-segmented")) glassKit?.segment(group);
    glassKit?.sync(glassOn(), document.documentElement.getAttribute("data-zennia-color-mode"));
    for (const select of settings.querySelectorAll("select")) {
      const trigger = html("button", "");
      trigger.type = "button";
      trigger.className = "zennia-select-trigger";
      trigger.setAttribute("aria-haspopup", "menu");
      trigger.setAttribute("aria-expanded", "false");
      const label = select.closest("label")?.querySelector("span")?.textContent || "Choose option";
      const description = select.getAttribute("aria-describedby");
      if (description) trigger.setAttribute("aria-describedby", description);
      const menu = html("div", "");
      menu.className = "zennia-select-menu";
      // Manual, so closing can play its motion before the list leaves the top layer.
      menu.setAttribute("popover", glassKit ? "manual" : "auto");
      menu.setAttribute("role", "menu");
      const triggerLabel = html("span", "");
      trigger.append(triggerLabel, icon("chevron"));
      const motion = glassKit?.popup(trigger, menu, { gap: () => (glassOn() ? 12 : 4), glass: glassOn }) ?? null;
      const options = () => [...menu.children].filter(item => item.matches("button"));
      const sync = () => {
        triggerLabel.textContent = select.selectedOptions[0]?.textContent || "Choose";
        trigger.setAttribute("aria-label", `${label}: ${triggerLabel.textContent}`);
        trigger.disabled = select.disabled;
        for (const item of options()) item.setAttribute("aria-checked", String(item.dataset.value === select.value));
      };
      const isOpen = () => (motion ? motion.open : menu.matches(":popover-open"));
      const hide = (immediate = false) => {
        trigger.setAttribute("aria-expanded", "false");
        if (motion) motion.hide(immediate);
        else menu.hidePopover();
      };
      const show = () => {
        sync();
        trigger.setAttribute("aria-expanded", "true");
        if (motion) motion.show();
        else {
          menu.showPopover();
          menu.setAttribute("data-glass-state", "open");
          const r = trigger.getBoundingClientRect();
          const view = settings.ownerDocument.defaultView;
          menu.style.left = Math.min(r.left, view.innerWidth - menu.offsetWidth - 8) + "px";
          menu.style.top = Math.min(r.bottom + 4, view.innerHeight - menu.offsetHeight - 8) + "px";
        }
        (menu.querySelector('[aria-checked="true"]') || options()[0])?.focus({ preventScroll: true });
      };
      selectMenus.push({ menu, hide });
      for (const option of select.options) {
        const item = html("button", option.textContent);
        item.type = "button";
        item.tabIndex = -1;
        item.dataset.value = option.value;
        item.setAttribute("role", "menuitemradio");
        item.addEventListener("click", () => {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
          sync(); hide(); trigger.focus();
        });
        menu.append(item);
      }
      trigger.addEventListener("click", () => (isOpen() ? hide() : show()));
      menu.addEventListener("keydown", event => {
        const items = options(), index = items.indexOf(settings.ownerDocument.activeElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].focus();
        }
        if (event.key === "Escape") {
          event.stopPropagation();
          hide(); trigger.focus();
        }
      });
      if (motion) {
        // A manual popover has no light dismiss of its own: a press outside it, or focus
        // leaving it, closes it the way an item does.
        settings.addEventListener("pointerdown", event => {
          if (isOpen() && !menu.contains(event.target) && !trigger.contains(event.target)) hide();
        }, true);
        menu.addEventListener("focusout", event => {
          if (isOpen() && event.relatedTarget && !menu.contains(event.relatedTarget) && event.relatedTarget !== trigger) hide();
        });
      } else menu.addEventListener("toggle", () => {
        const open = menu.matches(":popover-open");
        trigger.setAttribute("aria-expanded", String(open));
        if (!open) menu.removeAttribute("data-glass-state");
      });
      select.hidden = true;
      select.after(trigger, menu);
      select.addEventListener("change", sync);
      new MutationObserver(sync).observe(select, { attributes: true, subtree: true });
      sync();
    }
    function openSettings() {
      if (settingsWindow && !settingsWindow.closed) {
        settingsWindow.focus();
        return;
      }
      resetEditMode();
      const host = Services.ww.openWindow(window,
        "chrome://zennia/content/features/library/settings.xhtml", "zennia-settings",
        "chrome,titlebar,close,minimizable,resizable,centerscreen,dependent,width=640,height=640", null);
      settingsWindow = host;
      host.addEventListener("load", () => {
        // XUL window documents have no document.body; find the HTML body.
        host.document.querySelector("body").append(settings);
        // Firefox's own window buttons (see settings.xhtml) need their actions.
        const control = (name, action) => host.document.querySelector(`.titlebar-${name}`)
          ?.addEventListener("command", action);
        control("min", () => host.minimize());
        control("max", () => host.maximize());
        control("restore", () => host.restore());
        control("close", () => host.close());
        // The browser skin swaps Maximize for Restore by the root's sizemode.
        const syncSizeMode = () => host.document.documentElement.setAttribute("sizemode",
          host.windowState === host.STATE_MAXIMIZED ? "maximized" : "normal");
        host.addEventListener("sizemodechange", syncSizeMode);
        syncSizeMode();
        settings.show();
        host.document.title = title.textContent;
        applyAppearance();
        void refreshFont();
        host.addEventListener("blur", () => closeSelectMenus());
        host.addEventListener("resize", () => closeSelectMenus(true));
        syncModeThumb();
        host.requestAnimationFrame(syncModeThumb);
        host.addEventListener("keydown", event => {
          if (event.key === "Escape" && !settings.querySelector(":popover-open")) host.close();
        });
        // Register after navigation: the initial about:blank unload is not a close.
        host.addEventListener("unload", () => {
          closeSelectMenus(true);
          glassKit?.sync(false);
          if (settings.open) settings.close();
          document.documentElement.append(settings);
          if (settingsWindow === host) settingsWindow = null;
        }, { once: true });
      }, { once: true });
    }
    for (const [label, image, action] of [
      ["GitHub", "github", () => {
        window.openTrustedLinkIn("https://github.com/SpyC0der77/zennia", "tab");
        void setRail(false).catch(report);
      }],
      ["Settings", "settings", () => openSettings()],
    ]) {
      const item = document.createXULElement("menuitem");
      item.setAttribute("label", label);
      item.classList.add("menuitem-iconic");
      item.setAttribute("image", `chrome://zennia/content/menu-icons/${image}.svg`);
      item.addEventListener("command", action);
      projectMenu.append(item);
    }
    const donateImages = new Map();
    function syncLibraryFooter() {
      const footer = library.querySelector(zen.name("#zen-library-footer"));
      const donate = footer?.querySelector(
        '[data-l10n-id="library-footer-donate-button"]',
      );
      if (!donate) return;
      if (!donateImages.has(donate))
        donateImages.set(donate, donate.getAttribute("image"));
      const heart = "chrome://zennia/content/menu-icons/heart.svg";
      if (donate.getAttribute("image") !== heart)
        donate.setAttribute("image", heart);
      if (footer.querySelector("#zennia-project-github-button")) return;
      const github = document.createXULElement("toolbarbutton");
      github.id = "zennia-project-github-button";
      github.className = "toolbarbutton-1";
      github.setAttribute(
        "image",
        "chrome://zennia/content/menu-icons/menu.svg",
      );
      github.setAttribute("tooltiptext", "Zennia menu");
      github.setAttribute("aria-label", "Zennia menu");
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
    const content = document.getElementById(zen.name("zen-appcontent-wrapper"));
    // Replaced at the descriptor level, so this uses the version's member name.
    const openProgress = zen.member("zen-library", "openProgress");
    const progressDescriptor = Object.getOwnPropertyDescriptor(
      NativeLibrary.prototype, openProgress,
    );
    const root = document.documentElement;
    const resizeProgress = function (value) {
      progressDescriptor.set.call(this, value);
      if (this !== library) return;
      const transform = content.style.getPropertyValue("transform");
      const match = /^translateX\((-?[\d.]+)px\)$/.exec(transform);
      const offset = value > 0 && match ? Number(match[1]) : 0;
      root.style.setProperty("--zennia-library-left", `${Math.max(0, offset)}px`);
      root.style.setProperty("--zennia-library-right", `${Math.max(0, -offset)}px`);
      root.toggleAttribute("data-zennia-library-resize", value > 0 && !!match);
    };
    if (progressDescriptor?.configurable && progressDescriptor.set) {
      Object.defineProperty(NativeLibrary.prototype, openProgress, {
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
    gift.id = "zennia-gift-button";
    gift.className =
      zen.name("toolbarbutton-1 zen-sidebar-action-button zennia-icon-button zennia");
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
    gift.setAttribute("aria-controls", "zennia-download-popup");
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
    (document.getElementById(zen.name("zen-sidebar-foot-buttons")) || toolbox).prepend(
      gift,
    );

    return {
      gift,
      setRail,
      isOpen: () => NativeLibrary.isLibrarySlightlyOpen,
      destroy() {
        if (Object.getOwnPropertyDescriptor(NativeLibrary.prototype, openProgress)?.set === resizeProgress)
          Object.defineProperty(NativeLibrary.prototype, openProgress, progressDescriptor);
        root.removeAttribute("data-zennia-library-resize");
        root.style.removeProperty("--zennia-library-left");
        root.style.removeProperty("--zennia-library-right");
        if (NativeLibrary.animateProgress === animateLibrary)
          NativeLibrary.animateProgress = originalLibraryAnimate;
        libraryObserver.disconnect();
        footerObserver.disconnect();
        editorWindow?.close();
        settingsWindow?.close();
        Services.prefs.removeObserver(prefBranch, appearanceObserver);
        systemScheme.removeEventListener("change", applyAppearance);
        reducedTransparency.removeEventListener("change", onTransparencyChange);
        closeSelectMenus(true);
        document.documentElement.removeAttribute("data-zennia-color-mode");
        document.documentElement.removeAttribute("data-zennia-gradient");
        document.documentElement.style.removeProperty("--zennia-shell-gradient");
        document.documentElement.style.removeProperty("--zennia-shell-gradient-tint");
        document.documentElement.style.removeProperty("--zennia-window-opacity");
        document.documentElement.style.removeProperty("--zennia-content-radius");
        for (const [, , variable] of appearance) document.documentElement.style.removeProperty(variable);
        document.documentElement.removeAttribute("data-zennia-reduced-motion");
        projectMenu.remove();
        glassKit?.destroy();
        settings.remove();
        updater.listeners.delete(syncTrack);
        updater.listeners.delete(syncRemoval);
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
  installLegacy(window, { icon, nudge, hideDownloads, report, zen }) {
    const { document } = window;
    const gift = document.createXULElement("toolbarbutton");
    gift.id = "zennia-gift-button";
    gift.className = zen.name("toolbarbutton-1 zen-sidebar-action-button zennia-icon-button zennia");
    gift.setAttribute("aria-label", "Library (hover for downloads)");
    gift.setAttribute("aria-haspopup", "menu");
    gift.setAttribute("aria-expanded", "false");
    gift.setAttribute("aria-pressed", "false");
    gift.append(icon("gift"));
    const popup = document.createXULElement("menupopup");
    popup.id = "zennia-legacy-library";
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
        // Zen 1.22b and 1.22.1b still ship this module under resource:///modules/.
        const load = url => window.ChromeUtils.importESModule(url);
        let utils;
        try { utils = load("moz-src:///browser/components/sessionstore/RecentlyClosedTabsAndWindowsMenuUtils.sys.mjs"); }
        catch { utils = load("resource:///modules/sessionstore/RecentlyClosedTabsAndWindowsMenuUtils.sys.mjs"); }
        const { RecentlyClosedTabsAndWindowsMenuUtils } = utils;
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
    (document.getElementById(zen.name("zen-sidebar-foot-buttons")) || document.getElementById("navigator-toolbox")).prepend(gift);
    return { gift, setRail, isOpen, destroy() { popup.hidePopup(); popup.remove(); gift.remove(); } };
  },
};
