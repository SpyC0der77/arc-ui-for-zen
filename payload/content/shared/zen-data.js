/* Per-version Zen data: resolution, validation and renaming. Pure functions,
 * shared by the browser runtime (as a subscript) and the installer (as CommonJS). */
var ZenniaZenData = {
  VERSION_PATTERN: /^\d+\.\d+(?:\.\d+)?[a-z]?$/,
  RENAME_KINDS: ["names", "globals", "members", "prefs", "urls"],
  // DOM ids, classes, attributes, commands and CSS custom properties.
  NAME_PATTERN: /(?<![\w$-])(?:--|cmd_|context_)?zen(?:-[A-Za-z0-9_-]*[A-Za-z0-9_]|[A-Z_]\w*)(?![\w-])/g,

  // Version files hold only what differs from base.json. Objects merge key by
  // key; arrays and values replace the base value.
  merge(base, overlay) {
    const out = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
      const plain = (item) => item && typeof item === "object" && !Array.isArray(item);
      out[key] = plain(value) && plain(base[key]) ? this.merge(base[key], value) : value;
    }
    return out;
  },

  resolve(base, entry) {
    const resolved = this.merge(base, entry);
    this.validate(resolved);
    return resolved;
  },

  validate(data) {
    const fail = (message) => {
      throw new Error(`Invalid Zen version data for ${data.version || "unknown version"}: ${message}`);
    };
    if (typeof data.version !== "string" || !this.VERSION_PATTERN.test(data.version)) fail("version must look like 1.24b or 1.24.1b");
    const windows = data.runtime?.["windows-x64"];
    if (windows?.url !== `https://github.com/zen-browser/desktop/releases/download/${data.version}/zen.installer.exe` ||
        !/^[a-f0-9]{64}$/.test(windows.sha256 || "")) fail("runtime.windows-x64 needs the official installer URL and its SHA-256");
    if (!["native", "menu"].includes(data.features?.library)) fail('features.library must be "native" or "menu"');
    for (const flag of ["archive", "debugMode", "liveFolders", "boosts"])
      if (typeof data.features[flag] !== "boolean") fail(`features.${flag} must be true or false`);
    for (const group of [data.prefs, ...Object.values(data.platformPrefs || {})])
      for (const [key, value] of Object.entries(group || {}))
        if (!/^[\w.-]+$/.test(key) || !["string", "number", "boolean"].includes(typeof value)) fail(`invalid preference ${key}`);
    for (const kind of this.RENAME_KINDS)
      for (const [from, to] of Object.entries(data.renames?.[kind] || {}))
        if (typeof to !== "string" || !to || from === to) fail(`renames.${kind}.${from} must name a different value`);
    for (const key of Object.keys(data.renames?.members || {})) if (!/^[^.]+\.[^.]+$/.test(key)) fail(`renames.members key ${key} must be owner.member`);
    if (data.notes !== undefined && typeof data.notes !== "string") fail("notes must be text");
    if (!data.unavailable || typeof data.unavailable !== "object" || Array.isArray(data.unavailable)) fail("unavailable must group names by area");
    for (const [area, names] of Object.entries(data.unavailable))
      if (!Array.isArray(names) || names.some((item) => typeof item !== "string")) fail(`unavailable["${area}"] must be a list of names`);
    for (const [owner, members] of Object.entries(data.apis || {}))
      if (!Array.isArray(members) || members.some((item) => typeof item !== "string")) fail(`apis.${owner} must be a list of member names`);
  },

  // Every name the version lacks, across its areas.
  unavailableNames(data) {
    return new Set(Object.values(data.unavailable).flat());
  },

  // Managed preferences for one platform ("windows", "macos" or "linux").
  prefsFor(data, platform) {
    return { ...data.prefs, ...(data.platformPrefs?.[platform] || {}) };
  },

  // Applies DOM/CSS identifier renames to selectors, class lists or stylesheet text.
  renameNames(text, names) {
    if (!names || !Object.keys(names).length) return text;
    return text.replace(this.NAME_PATTERN, (name) => names[name] || name);
  },

  // Helpers for one resolved version. Feature code writes Zen names as they
  // appear in base.json; DOM names, preferences and URLs pass through these
  // helpers, while renamed globals and members are aliased where they live.
  // `host` supplies importModule(url) and readText(url).
  create(data, host) {
    const tools = this;
    const { renames } = data;
    const stylesheets = new Map();
    // Forwards a member's base name to its new name, unless the base name still exists.
    const alias = (target, canonical, actual) => {
      if (!target || canonical in target || !(actual in target)) return;
      Object.defineProperty(target, canonical, {
        configurable: true,
        get() {
          return this[actual];
        },
        set(value) {
          this[actual] = value;
        },
      });
    };
    const aliasMembers = (owner, target) => {
      for (const [key, actual] of Object.entries(renames.members)) {
        const [keyOwner, canonical] = key.split(".");
        if (keyOwner === owner) alias(target, canonical, actual);
      }
    };
    const inline = (url) =>
      host.readText(url).replace(/@import\s+url\("([^"]+)"\)\s*;/g, (_, child) => inline(child));
    return {
      version: data.version,
      data,
      features: data.features,
      name: (text) => tools.renameNames(text, renames.names),
      pref: (name) => renames.prefs[name] || name,
      url: (url) => renames.urls[url] || url,
      // Member name for descriptor-level work, where an alias cannot stand in.
      member: (owner, name) => renames.members[`${owner}.${name}`] || name,
      import(url, exportName) {
        const value = host.importModule(this.url(url))[renames.globals[exportName] || exportName];
        aliasMembers(exportName, value);
        return value;
      },
      // Without renames this returns the URL unchanged, so the browser loads it
      // as before. Otherwise @imports are inlined and the renames applied.
      stylesheet(url) {
        if (!Object.keys(renames.names).length) return url;
        if (!stylesheets.has(url))
          stylesheets.set(url, "data:text/css;charset=utf-8," + encodeURIComponent(this.name(inline(url))));
        return stylesheets.get(url);
      },
      attach(window) {
        for (const [canonical, actual] of Object.entries(renames.globals)) alias(window, canonical, actual);
        const owners = new Set(Object.keys(renames.members).map((key) => key.split(".")[0]));
        for (const owner of owners) {
          if (!owner.includes("-")) aliasMembers(owner, window[owner]);
          else
            window.customElements.whenDefined(this.name(owner)).then((element) => {
              aliasMembers(owner, element);
              aliasMembers(owner, element.prototype);
            });
        }
      },
    };
  },
};
if (typeof module === "object") module.exports = ZenniaZenData;
