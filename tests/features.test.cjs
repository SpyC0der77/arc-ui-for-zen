const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const content = path.join(__dirname, "../payload/content");
function load(file, name) {
  const scope = {};
  vm.runInNewContext(fs.readFileSync(path.join(content, file), "utf8"), scope, {
    filename: file,
  });
  return scope[name];
}
function clock() {
  let next = 0;
  const timers = new Map();
  return {
    timers,
    matchMedia: () => ({ matches: false }),
    setTimeout(fn) {
      timers.set(++next, fn);
      return next;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
}
test("legacy browsers keep idle tabs open when native Archive storage is absent", () => {
  let started = false;
  const feature = load("features/archive/auto-archive.js", "ArcAutoArchive").install({
    document: {querySelector: () => null},
  }, {createMotion() { started = true; throw Error("must not start timers"); }});
  assert.equal(feature.hours(), null);
  assert.equal(started, false);
  feature.destroy();
});
test("one feature can stop without cancelling another feature in the same window", () => {
  const window = clock();
  const motion = load("shared/motion.js", "ArcMotion");
  const sidebar = motion.install(window),
    downloads = motion.install(window);
  let calls = 0;
  sidebar.later(() => {
    throw Error("cancelled sidebar timer ran");
  }, 10);
  downloads.later(() => calls++, 10);
  sidebar.destroy();
  assert.equal(window.timers.size, 1);
  for (const [id, fn] of window.timers) {
    window.timers.delete(id);
    fn();
  }
  assert.equal(calls, 1);
  downloads.destroy();
  assert.equal(window.timers.size, 0);
});
test("destroy cancels animation and prevents delayed continuations from scheduling more work", async () => {
  const window = clock();
  const motion = load("shared/motion.js", "ArcMotion").install(window);
  let reject,
    cancelled = 0;
  const animation = {
    finished: new Promise((resolve, fail) => {
      reject = fail;
    }),
    cancel() {
      cancelled++;
      reject(Error("cancelled"));
    },
  };
  const element = { animate: () => animation };
  const finished = motion.animate(element, [], {});
  motion.destroy();
  await finished;
  assert.ok(cancelled > 0);
  assert.equal(
    motion.later(() => {}, 1),
    0,
  );
  await motion.animate(
    {
      animate() {
        throw Error("destroyed motion restarted");
      },
    },
    [],
    {},
  );
  assert.equal(window.timers.size, 0);
});
test("reduced motion skips visual animation but leaves nonvisual feedback timers working", async () => {
  const window = clock();
  window.matchMedia = () => ({ matches: true });
  const motion = load("shared/motion.js", "ArcMotion").install(window);
  await motion.animate(
    {
      animate() {
        throw Error("animation should be skipped");
      },
    },
    [],
    {},
  );
  motion.later(() => {}, 1);
  assert.equal(window.timers.size, 1);
  motion.destroy();
});
function widthFixture(prefs) {
  const listeners = new Map(),
    values = new Map();
  const toolbox = {
    style: { setProperty: (key, value) => values.set(key, value) },
    setAttribute: (key, value) => values.set(key, value),
  };
  const window = {
    document: { getElementById: () => toolbox },
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      assert.equal(listeners.get(type), fn);
      listeners.delete(type);
    },
  };
  const feature = load("features/sidebar/width.js", "ArcSidebarWidth").install(
    window,
    { Services: { prefs } },
  );
  return { feature, toolbox, listeners, values };
}
test("initial sidebar width is set once and subsequent windows preserve the user width", () => {
  let initialized = false;
  const prefs = {
    getBoolPref: () => initialized,
    setBoolPref: (key, value) => {
      initialized = value;
    },
  };
  const first = widthFixture(prefs);
  assert.equal(first.toolbox.style.width, "264px");
  assert.equal(first.values.get("--zen-sidebar-width"), "264px");
  const second = widthFixture(prefs);
  assert.equal(second.toolbox.style.width, undefined);
  first.feature.destroy();
  second.feature.destroy();
  assert.equal(first.listeners.size, 0);
  assert.equal(second.listeners.size, 0);
});
test("only primary-button double-clicks on the native splitter are intercepted", () => {
  const { feature, listeners } = widthFixture({ getBoolPref: () => true });
  let blocked = 0;
  const event = {
    button: 0,
    target: { id: "zen-sidebar-splitter" },
    preventDefault: () => blocked++,
    stopImmediatePropagation: () => blocked++,
  };
  const handler = listeners.get("dblclick");
  handler({ ...event, button: 1 });
  handler({ ...event, target: { id: "other" } });
  assert.equal(blocked, 0);
  handler(event);
  assert.equal(blocked, 2);
  feature.destroy();
});
test("stylesheet entrypoint imports existing local styles exactly once", () => {
  const css = fs.readFileSync(path.join(content, "../arc.css"), "utf8");
  const imports = [
    ...css.matchAll(/@import url\("chrome:\/\/arc-ui\/content\/([^"\n]+)"\);/g),
  ].map((match) => match[1]);
  assert.ok(imports.length > 0);
  assert.equal(new Set(imports).size, imports.length);
  for (const file of imports) {
    assert.ok(fs.readFileSync(path.join(content, file), "utf8").trim(), file);
    assert.ok(!file.includes(".."));
  }
});

test("a failed sidebar measurement does not block the next dock attempt", async () => {
  let missing = true, updates = 0;
  const node = {getBoundingClientRect: () => ({width:0,height:0}), matches: () => false,
    removeAttribute() {}};
  const manager = {preference:false, _setElementExpandAttribute() {},
    clearFlashTimeout() {}, _updateEvent() { updates++; }};
  const window = {
    document: {documentElement:{removeAttribute() {}}, getElementById(id) {
      return id === 'zen-toolbar-background' && missing ? null : node;
    }},
    gZenCompactModeManager: manager,
    getComputedStyle: () => ({visibility:'hidden'}),
    addEventListener() {}, removeEventListener() {},
  };
  const feature = load('features/sidebar/compact-mode.js', 'ArcCompactSidebar').install(window, {
    createMotion: () => ({reduced: () => true, destroy() {}}), updateNav() {},
  });
  await assert.rejects(manager._updateEvent());
  missing = false;
  await manager._updateEvent();
  assert.equal(updates, 1);
  feature.destroy();
});
test('application menu placement respects nonzero screen work-area edges', () => {
  const listeners = new Map();
  let position;
  const popup = {
    getBoundingClientRect: () => ({left: -30, top: -50, width: 332, height: 700}),
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: type => listeners.delete(type),
    moveTo: (x, y) => { position = {x, y}; },
  };
  const document = {
    getElementById: id => id === 'appMenu-popup' ? popup : null,
    addEventListener() {}, removeEventListener() {},
  };
  const feature = load('features/menus/create-menu.js', 'ArcMenus').install({
    document, mozInnerScreenX: 0, mozInnerScreenY: 0,
    screen: {availLeft: 40, availTop: 60, availWidth: 1200, availHeight: 900},
  });
  listeners.get('popupshown')();
  assert.deepEqual(position, {x: 48, y: 68});
  popup.getBoundingClientRect = () => ({left: 1100, top: 800, width: 332, height: 700});
  listeners.get('popupshown')();
  assert.deepEqual(position, {x: 900, y: 252});
  feature.destroy();
  assert.equal(listeners.size, 0);
});

test("background gradients keep separate light and dark colors and validate saved values", () => {
  const library = load("features/library/library.js", "ArcLibrary");
  const values = new Map([
    ["arc-ui.appearance.light.background", "#aabbcc"],
    ["arc-ui.appearance.light.gradient-end", "#ccbbaa"],
    ["arc-ui.appearance.light.gradient", true],
    ["arc-ui.appearance.light.gradient-angle", 90],
    ["arc-ui.appearance.dark.background", "url(unsafe)"],
    ["arc-ui.appearance.dark.gradient-end", "invalid"],
    ["arc-ui.appearance.dark.gradient-angle", 999],
  ]);
  const prefs = Object.fromEntries(["getStringPref", "getIntPref", "getBoolPref"].map(name =>
    [name, (key, fallback) => values.has(key) ? values.get(key) : fallback]));
  const light = library.background(prefs, "light");
  assert.equal(light.start, "#aabbcc");
  assert.equal(light.end, "#ccbbaa");
  assert.equal(light.angle, 90);
  assert.equal(light.enabled, true);
  const dark = library.background(prefs, "dark");
  assert.equal(dark.start, "#23202a");
  assert.equal(dark.end, "#493b56");
  assert.equal(dark.angle, 360);
  assert.equal(dark.enabled, false);
  values.set("arc-ui.appearance.dark.gradient-angle", -20);
  assert.equal(library.background(prefs, "dark").angle, 0);
  values.clear();
  assert.equal(library.background(prefs, "light").angle, 135);
  assert.equal(library.background(prefs, "light").enabled, false);
});

test("theme presets validate saved settings and ignore unrelated preference keys", () => {
  const library = load("features/library/library.js", "ArcLibrary");
  const stored = new Map([
    ["arc-ui.appearance.mode", "dark"],
    ["arc-ui.appearance.content-radius", 0],
    ["arc-ui.appearance.dark.opacity", 52],
    ["arc-ui.appearance.dark.gradient", true],
    ["arc-ui.appearance.dark.gradient-angle", 240],
  ]);
  const prefs = {};
  for (const [get, set] of [["getStringPref", "setStringPref"], ["getIntPref", "setIntPref"], ["getBoolPref", "setBoolPref"]]) {
    prefs[get] = (key, fallback) => stored.has(key) ? stored.get(key) : fallback;
    prefs[set] = (key, value) => stored.set(key, value);
  }
  const snapshot = library.snapshot(prefs);
  assert.equal(snapshot["dark.opacity"], 52);
  assert.equal(snapshot["content-radius"], 0);
  assert.equal(snapshot["dark.gradient-angle"], 240);
  stored.clear();
  library.applyPreset(prefs, { ...snapshot, "dark.background": "url(unsafe)", "light.opacity": 101, "content-radius": -2, "browser.startup.homepage": "unsafe" });
  assert.equal(stored.get("arc-ui.appearance.dark.opacity"), 52);
  assert.equal(stored.get("arc-ui.appearance.dark.background"), "#23202a");
  assert.equal(stored.get("arc-ui.appearance.light.opacity"), 70);
  assert.equal(stored.get("arc-ui.appearance.content-radius"), 10);
  assert.equal(stored.has("arc-ui.appearance.browser.startup.homepage"), false);
  assert.equal(stored.get("arc-ui.appearance.mode"), "dark");
});

test("saved theme presets recover from malformed data and normalize duplicate names", () => {
  const library = load("features/library/library.js", "ArcLibrary");
  let raw = "not json";
  const prefs = { getStringPref: () => raw };
  assert.equal(library.presets(prefs).length, 0);
  raw = '{"name":"not a list"}';
  assert.equal(library.presets(prefs).length, 0);
  raw = JSON.stringify([null, {name:" ", values:{}}, {name:"Example", values:{"mode":"invalid","dark.opacity":30}}, {name:" example ", values:{}}, {name:"bad values", values:[]}]);
  const presets = library.presets(prefs);
  assert.equal(presets.length, 1);
  assert.equal(presets[0].name, "Example");
  assert.equal(presets[0].values.mode, "system");
  assert.equal(presets[0].values["dark.opacity"], 30);
  raw = JSON.stringify(Array.from({length:25}, (_, i) => ({ name: String(i), values:{} })));
  assert.equal(library.presets(prefs).length, 20);
});

test("shared presets round-trip all appearance values without applying them or overwriting names", () => {
  const library = load("features/library/library.js", "ArcLibrary");
  const stored = new Map();
  const prefs = { getStringPref: (key, fallback) => stored.get(key) ?? fallback,
    setStringPref: (key, value) => stored.set(key, value) };
  const values = Object.fromEntries(library.schema().map(field => [field.key, field.fallback]));
  values.mode = "dark";
  values["dark.background"] = "#123456";
  values["light.opacity"] = 0;
  const name = "A".repeat(60);
  const text = library.exportPreset({ name, values });
  assert.deepEqual(JSON.parse(JSON.stringify(library.parsePreset(text))), {name, values});
  assert.equal(library.importPreset(prefs, text).name, name);
  const duplicate = library.importPreset(prefs, text);
  assert.equal(duplicate.name.length, 60);
  assert.equal(duplicate.name, "A".repeat(56) + " (2)");
  assert.equal(library.importPreset(prefs, text).name, "A".repeat(56) + " (3)");
  assert.equal(stored.size, 1, "imports only write the saved preset list");
  assert.equal(library.presets(prefs)[0].values["dark.background"], "#123456");
  const caseVariant = library.exportPreset({name: name.toLowerCase(), values});
  assert.equal(library.importPreset(prefs, caseVariant).name, "a".repeat(56) + " (4)");
});

test("invalid shared presets and full galleries leave saved data untouched", () => {
  const library = load("features/library/library.js", "ArcLibrary");
  let raw = "[]", writes = 0;
  const prefs = {getStringPref: () => raw, setStringPref: () => writes++};
  const values = Object.fromEntries(library.schema().map(field => [field.key, field.fallback]));
  const valid = {format: "arc-ui-preset", version: 1, name: "Sample", values};
  const invalid = ["broken", "x".repeat(65537), "null", "[]", ...[
    {...valid, version: 2}, {...valid, format: "other"}, {...valid, name: " "},
    {...valid, name: "x".repeat(61)}, {...valid, name: "bad\nname"},
    {...valid, values: []}, {...valid, values: {}},
    {...valid, values: {...values, mode: "invalid"}},
    {...valid, values: {...values, "dark.opacity": 101}},
    {...valid, values: {...values, "content-radius": 1.5}},
    {...valid, values: {...values, "reduce-motion": "false"}},
    {...valid, values: {...values, "dark.background": "url(unsafe)"}},
    {...valid, values: {...values, "browser.startup.homepage": "unsafe"}},
  ].map(value => JSON.stringify(value))];
  for (const text of invalid) assert.throws(() => library.importPreset(prefs, text));
  raw = JSON.stringify(Array.from({length: 20}, (_, i) => ({name: String(i), values})));
  assert.throws(() => library.importPreset(prefs, JSON.stringify(valid)), /20 presets/);
  assert.equal(writes, 0);
});
